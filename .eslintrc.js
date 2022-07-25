/**
 * Copyright 2020 Google LLC
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

module.exports = {
    "extends": [
        "eslint:recommended",
        "plugin:@typescript-eslint/eslint-recommended",
        "plugin:@typescript-eslint/recommended",
        "google"
    ],
    "rules": {
        "@typescript-eslint/no-explicit-any": "off",
        "new-cap": 0,
        "@typescript-eslint/no-unused-vars": "off",
        "comma-spacing": 0,
        "no-unused-vars": 0,
        "max-len": 0,
        "space-before-blocks": 0,
        "spaced-comment": 0,
        "keyword-spacing": 0,
        "indent": 0,
        "brace-style": 0,
        "require-jsdoc": 0,
        "prefer-const": 0,
        "arrow-parens": 0,
    },
    "env": {
        "browser": true,
        "es6": true
    },
    "parser": "@typescript-eslint/parser",
    "plugins": ["@typescript-eslint"],
  }