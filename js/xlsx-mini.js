// Gerador mínimo de arquivos Excel (.xlsx), sem dependências.
// Funciona no navegador e no Node. Uso:
//   const bytes = gerarXlsx([{ nome: 'Aba', colunas: [{ titulo, tipo: 'texto'|'num'|'moeda'|'data'|'pct', largura }], linhas: [[...], ...] }]);

const enc = new TextEncoder();
const xml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

// ---- ZIP (método "store", sem compressão) ----
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zip(arquivos) {
  const partes = [], central = []; let pos = 0;
  const u16 = (v) => [v & 0xFF, (v >>> 8) & 0xFF];
  const u32 = (v) => [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF];
  for (const [nome, conteudo] of arquivos) {
    const n = enc.encode(nome), d = typeof conteudo === 'string' ? enc.encode(conteudo) : conteudo, c = crc32(d);
    const cab = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(c), ...u32(d.length), ...u32(d.length), ...u16(n.length), ...u16(0)]);
    partes.push(cab, n, d);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(c), ...u32(d.length), ...u32(d.length), ...u16(n.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(pos)]), n);
    pos += cab.length + n.length + d.length;
  }
  const tamCentral = central.reduce((a, b) => a + b.length, 0);
  const fim = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(arquivos.length), ...u16(arquivos.length), ...u32(tamCentral), ...u32(pos), ...u16(0)]);
  const todas = [...partes, ...central, fim];
  const out = new Uint8Array(todas.reduce((a, b) => a + b.length, 0));
  let o = 0; for (const p of todas) { out.set(p, o); o += p.length; }
  return out;
}

// ---- planilha ----
const colLetra = (i) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
// estilos: 0 normal, 1 cabeçalho, 2 moeda, 3 data, 4 número, 5 percentual, 6 linha de total (moeda negrito)
const ESTILO = { texto: 0, moeda: 2, data: 3, num: 4, pct: 5 };
const serialData = (iso) => { const [y, m, d] = iso.split('-').map(Number); return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000; };

function aba(def) {
  const cols = def.colunas;
  const linhas = [`<row r="1">${cols.map((c, i) => `<c r="${colLetra(i)}1" s="1" t="inlineStr"><is><t>${xml(c.titulo)}</t></is></c>`).join('')}</row>`];
  def.linhas.forEach((ln, ri) => {
    const r = ri + 2;
    const cel = ln.map((v, ci) => {
      if (v === null || v === undefined || v === '') return '';
      const ref = `${colLetra(ci)}${r}`, tipo = (cols[ci] || {}).tipo || 'texto';
      if (tipo === 'data' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return `<c r="${ref}" s="3"><v>${serialData(v)}</v></c>`;
      if ((tipo === 'moeda' || tipo === 'num' || tipo === 'pct') && typeof v === 'number' && isFinite(v)) return `<c r="${ref}" s="${ESTILO[tipo]}"><v>${tipo === 'pct' ? v / 100 : v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
    }).join('');
    linhas.push(`<row r="${r}">${cel}</row>`);
  });
  const larg = cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.largura || 14}" customWidth="1"/>`).join('');
  const ultima = `${colLetra(Math.max(0, cols.length - 1))}${def.linhas.length + 1}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${larg}</cols><sheetData>${linhas.join('')}</sheetData>${def.linhas.length ? `<autoFilter ref="A1:${ultima}"/>` : ''}</worksheet>`;
}

const ESTILOS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="&quot;R$&quot;\\ #,##0.00;[Red]\\-&quot;R$&quot;\\ #,##0.00"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0A2540"/></patternFill></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

export function gerarXlsx(abas) {
  const nomes = abas.map((a) => a.nome.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
  const arquivos = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${abas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>
${nomes.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
<definedNames>${abas.map((a, i) => a.linhas.length ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xml(nomes[i]).replace(/'/g, "''")}'!$A$1:$${colLetra(Math.max(0, a.colunas.length - 1))}$${a.linhas.length + 1}</definedName>` : '').join('')}</definedNames></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${abas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}
<Relationship Id="rId${abas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', ESTILOS],
    ...abas.map((a, i) => [`xl/worksheets/sheet${i + 1}.xml`, aba(a)]),
  ];
  return zip(arquivos);
}
