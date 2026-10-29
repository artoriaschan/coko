# Third-party notices

Parts of `src/tools/` are adapted from pi coding-agent 1.4.0
(https://github.com/earendil-works/pi/tree/v1.4.0/packages/coding-agent/src/core/tools):
truncation, read, write, edit and its diff helpers, ls, bash output handling, the file mutation queue,
and the grep / find result formatting. Parts of `src/extensions/mcp/` (tool naming, server config validation,
connection handling, tool adaptation and the resource tools) are adapted from
https://github.com/earendil-works/pi/tree/v1.4.0/packages/coding-agent/src/extensions/mcp and `src/core/mcp-servers.ts`;
the list pagination limits follow https://github.com/earendil-works/pi/tree/v1.4.0/packages/mcp/src/client.ts.
Files that contain adapted code say so in their header.

```text
MIT License

Copyright (c) 2025 Mario Zechner

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
