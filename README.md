# MDMA Language Support — VSCode Extension

Provides syntax highlighting, bracket matching, and snippets for `.mdma` (Markdown Mapped) files. See the [language specification and docs](https://dastfox.github.io/mdma/) for the full grammar and filter reference.

## Features

- **Syntax highlighting** for:
  - `@inputs` section and typed declarations
  - Block headers `<blockname>`
  - Multi-line block headers with `multiple: x in list` / `name: expr` modifiers
  - Template interpolation `{{ }}` and control tags `{% %}`
  - Template keywords (`if`, `for`, `elif`, `else`, `endif`, `endfor`, `in`, `not`, `and`, `or`)
  - Filter functions (`length`, `join`, `lower`, etc.)
  - Markdown content within blocks (headings, bold, italic, blockquotes, code)

- **Bracket auto-closing** for `{{ }}` and `{% %}` pairs

- **Snippets** — trigger with the prefix in any `.mdma` file:

  | Prefix | Description |
  |--------|-------------|
  | `@inputs` | Full file skeleton |
  | `input` | Single input declaration |
  | `block` | Named block header |
  | `multiple` | Block with a `multiple` header modifier |
  | `multiplename` | Block with `multiple` and `name` header modifiers |
  | `if` | Conditional block |
  | `ifw` | Conditional list section with whitespace control |
  | `for` | For loop |
  | `forw` | For loop with whitespace stripping |
  | `{{` | Interpolation tag |
  | `breaking` | Breaking change blockquote |

## Installation

### Development install (no packaging required)

```bash
cp -r /path/to/mdma-vscode ~/.vscode/extensions/mdma-language-0.0.1
```

Then **reload VSCode** (`Ctrl+Shift+P` → `Developer: Reload Window`).

### Package and install with vsce

```bash
npm install -g @vscode/vsce
vsce package
code --install-extension mdma-language-0.0.1.vsix
```

## Theme Compatibility

The extension uses standard TextMate scopes, so it works with any theme. Key scopes:

| Element | TextMate scope |
|---------|---------------|
| `@inputs` | `keyword.control.inputs.mdma` |
| Input name | `variable.parameter.input.mdma` |
| Type | `support.type.primitive.mdma` |
| Block name | `entity.name.section.block.mdma` |
| `multiple` modifier keyword | `keyword.control.multiple.mdma` |
| `name` modifier keyword | `keyword.control.name.mdma` |
| `{{ }}` delimiters | `punctuation.definition.template.expression.*.mdma` |
| `{% %}` delimiters | `punctuation.definition.tag.template.*.mdma` |
| Control keywords | `keyword.control.flow.mdma` |
| Variables | `variable.other.template.mdma` |
| Filters | `support.function.builtin.filter.mdma` |
| Markdown headings | `markup.heading.markdown.mdma` |
| Markdown bold | `markup.bold.markdown.mdma` |
