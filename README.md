# C++ Format

C++ Format is a clang-format based C++ code formatter. The code is derived from the [clang-format](https://marketplace.visualstudio.com/items?itemName=xaver.clang-format) extension. The primary goal is to fix the horrible vscode C++ code editing behavior. This extension is still experemental, please don't expect much from it.

## Usage:

- If you use `vscode-cpptools` extension, make sure you have `"C_Cpp.formatting": "Disabled"`
- Set `"editor.formatOnPaste": true` and `"editor.formatOnType": true`
- Set `"[cpp]": { "editor.defaultFormatter": "psycha0s.cpp-format" }`
- Enjoy

## Settings the path to clang-format executable

A path to clang-format executable can be set in settings.json file. You can set a different path depending on a platform:
```
{
    "cpp-format.executable": "/path/to/clang-format",
    "cpp-format.executable.windows": "/path/to/clang-format",
    "cpp-format.executable.linux": "/path/to/clang-format",
    "cpp-format.executable.osx": "/path/to/clang-format"
}
```
