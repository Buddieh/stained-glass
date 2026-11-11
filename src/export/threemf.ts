import { strToU8, zipSync } from 'fflate';
import type { MeshPart } from '../pipeline/types';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const num = (v: number) => {
  const s = v.toFixed(4);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
};

/**
 * Core-spec 3MF: one mesh object per part plus one assembly object that references them as
 * components, so slicers load it as a single object with one part per filament color.
 * Colors are written as base materials (display colors); assign filaments in the slicer.
 */
export function build3mf(parts: MeshPart[], title = 'Stained glass panel'): Uint8Array {
  const matId = 1;
  const firstObj = 2;
  const assemblyId = firstObj + parts.length;
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">');
  out.push(`<metadata name="Title">${esc(title)}</metadata>`);
  out.push('<metadata name="Application">Stained Glass Generator (buddieh.com/stained-glass)</metadata>');
  out.push('<resources>');
  out.push(`<basematerials id="${matId}">`);
  for (const p of parts) out.push(`<base name="${esc(p.name)}" displaycolor="${p.color.toUpperCase()}FF"/>`);
  out.push('</basematerials>');
  parts.forEach((p, i) => {
    out.push(`<object id="${firstObj + i}" type="model" name="${esc(p.name)}" pid="${matId}" pindex="${i}"><mesh><vertices>`);
    const pos = p.positions;
    const v: string[] = [];
    for (let k = 0; k < pos.length; k += 3) v.push(`<vertex x="${num(pos[k])}" y="${num(pos[k + 1])}" z="${num(pos[k + 2])}"/>`);
    out.push(v.join(''));
    out.push('</vertices><triangles>');
    const t: string[] = [];
    const idx = p.indices;
    for (let k = 0; k < idx.length; k += 3) t.push(`<triangle v1="${idx[k]}" v2="${idx[k + 1]}" v3="${idx[k + 2]}"/>`);
    out.push(t.join(''));
    out.push('</triangles></mesh></object>');
  });
  out.push(`<object id="${assemblyId}" type="model" name="${esc(title)}"><components>`);
  parts.forEach((_, i) => out.push(`<component objectid="${firstObj + i}"/>`));
  out.push('</components></object>');
  out.push('</resources>');
  out.push(`<build><item objectid="${assemblyId}"/></build>`);
  out.push('</model>');

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>';
  const rels =
    '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>';

  return zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rels),
    '3D/3dmodel.model': strToU8(out.join('\n')),
  }, { level: 6 });
}
