# 第三方许可声明（Third-Party Notices）

本文件声明轻衡（Fitwise Local）仓库内置第三方素材的版权、许可与来源。项目自身的 JavaScript / Rust 依赖分别声明于 `package.json` 与 `src-tauri/Cargo.toml`（及各自 lock 文件），遵循其上游许可，本文件不逐项罗列。

## Noto Sans SC（界面字体子集）

| 项 | 内容 |
| --- | --- |
| 用途 | 应用界面字体 |
| 仓库内文件 | `src/assets/fonts/` 下 6 个 WOFF2 子集：`noto-sans-sc-chinese-simplified-400.woff2` / `-500.woff2` / `-600.woff2`、`noto-sans-sc-latin-400.woff2` / `-500.woff2` / `-600.woff2` |
| 原始字体 | Noto Sans SC（Noto Sans Simplified Chinese），Google 设计，2018-10-22 起经 Google Fonts 分发 |
| 版权声明 | Copyright 2014-2021 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'. |
| 许可证 | SIL Open Font License, Version 1.1（2007-02-26） |
| 上游来源 | Google Fonts：https://fonts.google.com/noto/sans/sc ；上游仓库：https://github.com/notofonts/noto-cjk ；许可与版权原文：https://github.com/google/fonts 的 `ofl/notosanssc` 目录 |

### 修改说明

仓库内的 WOFF2 文件是 Noto Sans SC 的派生版本（OFL 定义中的 Modified Version）：按用途提取字符子集（中文简体 / 拉丁），拆分为 400 / 500 / 600 三个静态字重，并转换为 WOFF2 格式。

### 保留字体名（Reserved Font Name）

上游声明的保留字体名为「Source」。本派生版本**未使用**该名称；仓库文件与界面样式中使用的名称为 Noto Sans SC。

### 许可传递

上述字体文件整体仍以 SIL Open Font License 1.1 分发（OFL 条件 5）；该要求不适用于使用该字体渲染的应用界面、文档或软件其余部分。随应用或仓库分发时，每份拷贝均包含版权声明与本许可全文（本文件及 `src/assets/fonts/OFL.txt`，满足 OFL 条件 2）。

## SIL Open Font License 1.1 全文

Copyright 2014-2021 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
https://scripts.sil.org/OFL


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply to
any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
