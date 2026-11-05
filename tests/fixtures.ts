import JSZip from 'jszip'

export const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlS8AAAAASUVORK5CYII='

export const codeLayoutSamples = {
  xml: '<intent-filter>\n    <action android:name="android.intent.action.VIEW" />\n\t<data android:scheme="example" />\n</intent-filter>',
  bash: '# 查看配置\nadb shell am start \\\n  --es route "example://page"\n\n# 分析安装包\naapt dump badging sample.apk',
  java: 'Intent intent = new Intent();\nintent.setClassName("example.app", "ExampleActivity");\nintent.putExtra("route", "example://page");\nstartActivity(intent);',
}

export async function codeWordFixture(): Promise<Buffer> {
  const zip = await JSZip.loadAsync(await wordFixture())
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const p = (text: string, mono = false) => `<w:p><w:r>${mono ? '<w:rPr><w:rFonts w:ascii="Courier New"/></w:rPr>' : ''}${text.split('\t').map(part => `<w:t xml:space="preserve">${escape(part)}</w:t>`).join('<w:tab/>')}</w:r></w:p>`
  const code = (text: string) => text.split('\n').map(line => p(line)).join('')
  const heading = (text: string) => `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`
  zip.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
    ${heading('XML 配置')}${code(codeLayoutSamples.xml)}${p('配置后的普通正文应保留。')}
    ${heading('命令行示例')}${code(codeLayoutSamples.bash)}${p('观察：这一段不应进入代码块。')}
    ${heading('Java 示例')}${code(codeLayoutSamples.java)}${p('Java 示例后的说明文字。')}
    ${p('ActivityNotFoundException', true)}${p('参数已被接收，以上是日志说明。')}
    <w:tbl><w:tr><w:tc>${p('参数')}</w:tc><w:tc>${p('含义')}</w:tc></w:tr><w:tr><w:tc>${p('jump_scheme', true)}</w:tc><w:tc>${p('javascript:example()', true)}${p('这只是文章中的字符串。')}</w:tc></w:tr></w:tbl>
    ${p('文章末尾完整保留。')}
  </w:body></w:document>`)
  return zip.generateAsync({ type: 'nodebuffer' })
}

export async function wordFixture(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`)
  zip.file('_rels/.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`)
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>`)
  zip.file('word/styles.xml', `<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>`)
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>
  <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>导入测试标题</w:t></w:r></w:p>
  <w:p><w:r><w:t>这是中文正文，数字 123 与标点应完整保留。</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>加粗内容</w:t></w:r></w:p>
  <w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="图片" descr="示例图片"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="rId2"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
  <w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格第一格</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>表格第二格</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
  <w:p><w:r><w:t>文章结尾。</w:t></w:r></w:p>
  </w:body></w:document>`)
  zip.file('word/media/image1.png', Buffer.from(pngBase64, 'base64'))
  return zip.generateAsync({ type: 'nodebuffer' })
}
