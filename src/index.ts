/**
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {Terminal} from 'xterm';
import {FitAddon} from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import {
  serial as polyfill, SerialPort as SerialPortPolyfill,
} from 'web-serial-polyfill';

/**
 * Elements of the port selection dropdown extend HTMLOptionElement so that
 * they can reference the SerialPort they represent.
 */
declare class PortOption extends HTMLOptionElement {
  port: SerialPort | SerialPortPolyfill;
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register(
          'service-worker.js', {scope: '.'});
      console.log('SW registered: ', registration);
    } catch (registrationError) {
      console.log('SW registration failed: ', registrationError);
    }
  });
}

let portSelector: HTMLSelectElement;
let connectButton: HTMLButtonElement;
let writeButton: HTMLButtonElement;
let bytesToWriteInput: HTMLInputElement;
let baudRateSelector: HTMLSelectElement;
let customBaudRateInput: HTMLInputElement;
let dataBitsSelector: HTMLSelectElement;
let paritySelector: HTMLSelectElement;
let stopBitsSelector: HTMLSelectElement;
let flowControlCheckbox: HTMLInputElement;
let echoCheckbox: HTMLInputElement;
let flushOnEnterCheckbox: HTMLInputElement;

let startStreaming = false;
let chipId: number;
let portCounter = 1;
let port: SerialPort | SerialPortPolyfill | undefined;
let reader: ReadableStreamDefaultReader | undefined;

let firmwareIdentifier: number;
let firmwareMajor: number;
let firmwareMinor: number;
let firmwareInternal: number;
let hardwareVersion: number;

let promise: Promise<void>;

const GET_FIRMWARE_VERSION_COMMAND = ConvertHexStringToByteArray('2E');
const GET_SHIMMER_VERSION_COMMAND = ConvertHexStringToByteArray('3F');
const START_STREAMING_COMMAND = ConvertHexStringToByteArray('07');
const STOP_STREAMING_COMMAND = ConvertHexStringToByteArray('20');
const GET_EXG_REG1_COMMAND = ConvertHexStringToByteArray('6300000A');
const GET_EXG_REG2_COMMAND = ConvertHexStringToByteArray('6301000A');
const SET_EXG_REG1_COMMAND = ConvertHexStringToByteArray('6100000A');
const SET_EXG_REG2_COMMAND = ConvertHexStringToByteArray('6100010A');
const SHIMMER3_DEFAULT_TEST_REG1 = new Uint8Array([0, 163, 16, 69, 69, 0, 0, 0, 2, 1]);
const SHIMMER3_DEFAULT_TEST_REG2 = new Uint8Array([0, 163, 16, 69, 69, 0, 0, 0, 2, 1]);

const urlParams = new URLSearchParams(window.location.search);
const usePolyfill = urlParams.has('polyfill');

const term = new Terminal({
  scrollback: 10_000,
});
const fitAddon = new FitAddon();
term.loadAddon(fitAddon);
const encoder = new TextEncoder();
let toFlush = '';
term.onData((data) => {
  if (echoCheckbox.checked) {
    term.write(data);
  }

  if (port?.writable == null) {
    console.warn(`unable to find writable port`);
    return;
  }

  const writer = port.writable.getWriter();

  if (flushOnEnterCheckbox.checked) {
    toFlush += data;
    if (data === '\r') {
      writer.write(encoder.encode(toFlush));
      writer.releaseLock();
      toFlush = '';
    }
  } else {
    writer.write(encoder.encode(data));
  }

  writer.releaseLock();
});

/**
 * Returns the option corresponding to the given SerialPort if one is present
 * in the selection dropdown.
 *
 * @param {SerialPort} port the port to find
 * @return {PortOption}
 */
function findPortOption(port: SerialPort | SerialPortPolyfill):
    PortOption | null {
  for (let i = 0; i < portSelector.options.length; ++i) {
    const option = portSelector.options[i];
    if (option.value === 'prompt') {
      continue;
    }
    const portOption = option as PortOption;
    if (portOption.port === port) {
      return portOption;
    }
  }

  return null;
}

/**
 * Adds the given port to the selection dropdown.
 *
 * @param {SerialPort} port the port to add
 * @return {PortOption}
 */
function addNewPort(port: SerialPort | SerialPortPolyfill): PortOption {
  const portOption = document.createElement('option') as PortOption;
  portOption.textContent = `Port ${portCounter++}`;
  portOption.port = port;
  portSelector.appendChild(portOption);
  return portOption;
}

/**
 * Adds the given port to the selection dropdown, or returns the existing
 * option if one already exists.
 *
 * @param {SerialPort} port the port to add
 * @return {PortOption}
 */
function maybeAddNewPort(port: SerialPort | SerialPortPolyfill): PortOption {
  const portOption = findPortOption(port);
  if (portOption) {
    return portOption;
  }

  return addNewPort(port);
}

/**
 * Download the terminal's contents to a file.
 */
function downloadTerminalContents(): void {
  if (!term) {
    throw new Error('no terminal instance found');
  }

  if (term.rows === 0) {
    console.log('No output yet');
    return;
  }

  term.selectAll();
  const contents = term.getSelection();
  term.clearSelection();
  const linkContent = URL.createObjectURL(
      new Blob([new TextEncoder().encode(contents).buffer],
          {type: 'text/plain'}));
  const fauxLink = document.createElement('a');
  fauxLink.download = `terminal_content_${new Date().getTime()}.txt`;
  fauxLink.href = linkContent;
  fauxLink.click();
}

/**
 * Sets |port| to the currently selected port. If none is selected then the
 * user is prompted for one.
 */
async function getSelectedPort(): Promise<void> {
  if (portSelector.value == 'prompt') {
    try {
      const serial = usePolyfill ? polyfill : navigator.serial;
      port = await serial.requestPort({});
    } catch (e) {
      return;
    }
    const portOption = maybeAddNewPort(port);
    portOption.selected = true;
  } else {
    const selectedOption = portSelector.selectedOptions[0] as PortOption;
    port = selectedOption.port;
  }
}

/**
 * @return {number} the currently selected baud rate
 */
function getSelectedBaudRate(): number {
  if (baudRateSelector.value == 'custom') {
    return Number.parseInt(customBaudRateInput.value);
  }
  return Number.parseInt(baudRateSelector.value);
}

/**
 * Resets the UI back to the disconnected state.
 */
function markDisconnected(): void {
  term.writeln('<DISCONNECTED>');
  portSelector.disabled = false;
  connectButton.textContent = 'Connect';
  connectButton.disabled = false;
  baudRateSelector.disabled = false;
  customBaudRateInput.disabled = false;
  dataBitsSelector.disabled = false;
  paritySelector.disabled = false;
  stopBitsSelector.disabled = false;
  flowControlCheckbox.disabled = false;
  port = undefined;
}

/**
 * Initiates a connection to the selected port.
 */
async function connectToPort(): Promise<void> {
  await getSelectedPort();
  if (!port) {
    return;
  }

  const options = {
    baudRate: getSelectedBaudRate(),
    dataBits: Number.parseInt(dataBitsSelector.value),
    parity: paritySelector.value as ParityType,
    stopBits: Number.parseInt(stopBitsSelector.value),
    flowControl:
        flowControlCheckbox.checked ? <const> 'hardware' : <const> 'none',

    // Prior to Chrome 86 these names were used.
    baudrate: getSelectedBaudRate(),
    databits: Number.parseInt(dataBitsSelector.value),
    stopbits: Number.parseInt(stopBitsSelector.value),
    rtscts: flowControlCheckbox.checked,
  };
  console.log(options);

  portSelector.disabled = true;
  connectButton.textContent = 'Connecting...';
  connectButton.disabled = true;
  baudRateSelector.disabled = true;
  customBaudRateInput.disabled = true;
  dataBitsSelector.disabled = true;
  paritySelector.disabled = true;
  stopBitsSelector.disabled = true;
  flowControlCheckbox.disabled = true;

  try {
    await port.open(options);
    term.writeln('<CONNECTED>');

    if (port?.writable == null) {
      console.warn(`unable to find writable port`);
      return;
    }

    const writer = port.writable.getWriter();
    let waitTime = 200;
    await setTimeout(function() {
      writer.write(GET_FIRMWARE_VERSION_COMMAND);
    }, waitTime += 200);
    await setTimeout(function() {
      writer.write(GET_SHIMMER_VERSION_COMMAND);
    }, waitTime += 200);

    await setTimeout(function() {
      if (firmwareIdentifier != 3 || hardwareVersion != 3){
        return;
      }
      for (let i = 0; i < SET_EXG_REG1_COMMAND.length; i++){
        writer.write(SET_EXG_REG1_COMMAND.subarray(i, i + 1));
      }
      for (let i = 0; i < SHIMMER3_DEFAULT_TEST_REG1.length; i++){
        writer.write(SHIMMER3_DEFAULT_TEST_REG1.subarray(i, i + 1));
      }
    }, waitTime += 200);

    setTimeout(function() {
      if (firmwareIdentifier != 3 || hardwareVersion != 3){
        return;
      }
      for (let i = 0; i < SET_EXG_REG2_COMMAND.length; i++){
        writer.write(SET_EXG_REG2_COMMAND.subarray(i, i + 1));
      }
      for (let i = 0; i < SHIMMER3_DEFAULT_TEST_REG2.length; i++){
        writer.write(SHIMMER3_DEFAULT_TEST_REG2.subarray(i, i + 1));
      }
    }, waitTime += 200);

    setTimeout(function() {
      if (firmwareIdentifier != 3 || hardwareVersion != 3){
        return;
      }
      chipId = 1;
      writer.write(GET_EXG_REG1_COMMAND);
    }, waitTime += 200);

    setTimeout(function() {
      if (firmwareIdentifier != 3 || hardwareVersion != 3){
        return;
      }
      chipId = 2;
      writer.write(GET_EXG_REG2_COMMAND);
      term.writeln('start streaming after 5 seconds');
    }, waitTime += 200);

    setTimeout(function() {
      startStreaming = true;
      writer.write(START_STREAMING_COMMAND);
    }, waitTime += 5000);

    setTimeout(function() {
      writer.releaseLock();
    }, waitTime += 200);

    connectButton.textContent = 'Disconnect';
    connectButton.disabled = false;
  } catch (e) {
    console.error(e);
    term.writeln(`<ERROR: ${e.message}>`);
    markDisconnected();
    return;
  }

  while (port && port.readable) {
    try {
      reader = port.readable.getReader();
      let temp: Uint8Array;
      const dataTypes = ['u24','u8','i24r','i24r','u8','i24r','i24r'];
      for (;;) {
        const {value, done} = await reader.read();
        if (value) {
          await new Promise<void>((resolve) => {
            //Because the byte array received is not always complete
            console.log(value);
            resolve();
            //term.write('new bytes received ');
            //term.write(Array.apply([], value).join(' '), resolve);
            //term.writeln('');
            if(value[0] == 255 && startStreaming){
              term.writeln('Ack Received');
              if(startStreaming){
                term.writeln('Start Streaming');
              }
            }
            if(value[0] == 255 || value[0] == 0){
                temp = new Uint8Array([...value]);
            }
            else{
              let temp2 = new Uint8Array(temp.length + value.length);
              temp2.set(temp);
              temp2.set(value, temp.length);
              temp = temp2;
            }
            if(temp[0] == 0 && temp.length == 18 && startStreaming){
              let parsedData: Array<number> = ParseData(temp.subarray(1), dataTypes);
              term.writeln(String(parsedData));
            }
            if(temp[1] == 47 && temp.length == 8){
              for(let i = 2; i < 8; i++){
                firmwareIdentifier = (temp[i++] & 0xFF) + ((temp[i++] & 0xFF) << 8);
                firmwareMajor = (temp[i++] & 0xFF) + ((temp[i++] & 0xFF) << 8);
                firmwareMinor = temp[i++];
                firmwareInternal = temp[i++];

                term.writeln('FW VERSION RESPONSE Received');
                term.writeln('Firmware identifier: ' + firmwareIdentifier);
                term.writeln('Firmware major: ' + firmwareMajor);
                term.writeln('Firmware minor: ' + firmwareMinor);
                term.writeln('Firmware internal: ' + firmwareInternal);
              }
            }
            else if(temp[1] == 37 && temp.length == 3){
              hardwareVersion = temp[2];
              term.writeln('Hardware version: ' + hardwareVersion);
            }
            else if(temp[1] == 98 && temp.length == 13)
            {
              if(chipId == 1){
                term.writeln('EXG CHIP 1 CONFIGURATION');
              }
              else{
                term.writeln('EXG CHIP 2 CONFIGURATION');
              }
              for(let i = 3; i < temp.length; i++){
                term.write(String(temp[i]) + ' ');
              }
              term.writeln('');
            }
          });
        }
        if (done) {
          break;
        }
      }
      reader.releaseLock();
      reader = undefined;
    } catch (e) {
      console.error(e);
      term.writeln(`<ERROR: ${e.message}>`);
    }
  }

  if (port) {
    try {
      await port.close();
    } catch (e) {
      console.error(e);
      term.writeln(`<ERROR: ${e.message}>`);
    }

    markDisconnected();
  }
}

/**
 * Closes the currently active connection.
 */
async function disconnectFromPort(): Promise<void> {
  // Move |port| into a local variable so that connectToPort() doesn't try to
  // close it on exit.
  const localPort = port;
  port = undefined;

  if (reader) {
    await reader.cancel();
  }

  if (localPort) {
    try {
      await localPort.close();
    } catch (e) {
      console.error(e);
      term.writeln(`<ERROR: ${e.message}>`);
    }
  }

  markDisconnected();
}

document.addEventListener('DOMContentLoaded', async () => {
  const terminalElement = document.getElementById('terminal');
  if (terminalElement) {
    term.open(terminalElement);
    fitAddon.fit();
  }

  const download = document.getElementById('download') as HTMLSelectElement;
  download.addEventListener('click', downloadTerminalContents);
  portSelector = document.getElementById('ports') as HTMLSelectElement;

  connectButton = document.getElementById('connect') as HTMLButtonElement;
  connectButton.addEventListener('click', () => {
    if (port) {
      disconnectFromPort();
    } else {
      connectToPort();
    }
  });

  writeButton = document.getElementById('write') as HTMLButtonElement;
  writeButton.addEventListener('click', () => {
    bytesToWriteInput =
    document.getElementById('bytesToWrite') as HTMLInputElement;
    const byteArray = ConvertHexStringToByteArray(bytesToWriteInput.value);
    if (byteArray == null){
      console.warn('input not valid');
      return;
    }
    if (port?.writable == null) {
      console.warn(`unable to find writable port`);
      return;
    }
    const writer = port.writable.getWriter();
    writer.write(byteArray);
    writer.releaseLock();
  });

  baudRateSelector = document.getElementById('baudrate') as HTMLSelectElement;
  baudRateSelector.addEventListener('input', () => {
    if (baudRateSelector.value == 'custom') {
      customBaudRateInput.hidden = false;
    } else {
      customBaudRateInput.hidden = true;
    }
  });

  customBaudRateInput =
      document.getElementById('custom_baudrate') as HTMLInputElement;
  dataBitsSelector = document.getElementById('databits') as HTMLSelectElement;
  paritySelector = document.getElementById('parity') as HTMLSelectElement;
  stopBitsSelector = document.getElementById('stopbits') as HTMLSelectElement;
  flowControlCheckbox = document.getElementById('rtscts') as HTMLInputElement;
  echoCheckbox = document.getElementById('echo') as HTMLInputElement;
  flushOnEnterCheckbox =
      document.getElementById('enter_flush') as HTMLInputElement;

  const convertEolCheckbox =
      document.getElementById('convert_eol') as HTMLInputElement;
  const convertEolCheckboxHandler = () => {
    term.setOption('convertEol', convertEolCheckbox.checked);
  };
  convertEolCheckbox.addEventListener('change', convertEolCheckboxHandler);
  convertEolCheckboxHandler();

  const serial = usePolyfill ? polyfill : navigator.serial;
  const ports: (SerialPort | SerialPortPolyfill)[] = await serial.getPorts();
  ports.forEach((port) => addNewPort(port));

  // These events are not supported by the polyfill.
  // https://github.com/google/web-serial-polyfill/issues/20
  if (!usePolyfill) {
    navigator.serial.addEventListener('connect', (event) => {
      addNewPort(event.target as SerialPort);
    });
    navigator.serial.addEventListener('disconnect', (event) => {
      const portOption = findPortOption(event.target as SerialPort);
      if (portOption) {
        portOption.remove();
      }
    });
  }
});

function ConvertHexStringToByteArray(hexString:string) {
  if(hexString.length == 0){
    throw new Error('hex string cannot be empty');
  }
  if (hexString.length % 2 !== 0) {
    throw new Error('Must have an even number of hex digits');
  }
  const numBytes = hexString.length / 2;
  const byteArray = new Uint8Array(numBytes);
  for (let i=0; i<numBytes; i++) {
    byteArray[i] = parseInt(hexString.substr(i*2, 2), 16);
  }
  return byteArray;
}

function ParseData(data:Uint8Array, dataTypes:Array<string>) {
  const parsedData: Array<number> = [];
  let j = 0;
  for (let i=0; i<dataTypes.length; i++) {
    if(dataTypes[i] === 'u8'){
      parsedData.push(data[j++]);
    }
    else if(dataTypes[i] === 'u24'){
      parsedData.push((data[j++] & 0xFF) + ((data[j++] & 0xFF) << 8) + ((data[j++] & 0xFF) << 16));
    }
    else if(dataTypes[i] === 'i24r'){
      //TODO complete parsing
      parsedData.push(((data[j++] & 0xFF) << 16) + ((data[j++] & 0xFF) << 8) + (data[j++] & 0xFF));
    }
  }
  return parsedData;
}

async function sleep(msec: number) {
    return new Promise(resolve => setTimeout(resolve, msec));
}
