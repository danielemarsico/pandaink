// W10 — SVG string generation and download trigger.
// Ports JsonSvg from export_win.py.
//
// Usage:
//   const svgString = drawingToSvg(drawing, orientation);
//   downloadSvg(svgString, 'my_drawing.svg');

const OUTPUT_SCALING    = 1000;
const BASE_PEN_WIDTH    = 0.4;
const PRESSURE_FACTOR   = 0.2;
const WIDTH_PRECISION   = 10;   // round to nearest 0.1
const MM_PER_UNIT       = 0.26458;   // 1 device unit in mm (matches svgwrite's mm helper)

/**
 * Convert a drawing record to an SVG string.
 *
 * @param {object} drawing     - { dimensions: [w, h], strokes: [[{x,y,p},...]] }
 * @param {string} orientation - 'portrait' | 'landscape' | 'reverse-portrait' | 'reverse-landscape'
 * @returns {string}           - SVG markup.
 */
export function drawingToSvg(drawing, orientation = 'portrait') {
    const ori = orientation.toLowerCase();
    const [rawW, rawH] = (drawing.dimensions && drawing.dimensions[0])
        ? drawing.dimensions
        : [21000, 14800];

    // Device width/height in output (mm) units
    const devW = rawW / OUTPUT_SCALING;
    const devH = rawH / OUTPUT_SCALING;

    // Swap W/H for portrait orientations (matches ImageExportBase.output_dimensions)
    const [svgW, svgH] = (ori === 'portrait' || ori === 'reverse-portrait')
        ? [devH, devW]
        : [devW, devH];

    const pxW = (svgW * MM_PER_UNIT * 3.7795).toFixed(2);  // mm → px at 96 dpi
    const pxH = (svgH * MM_PER_UNIT * 3.7795).toFixed(2);

    const paths = [];

    for (let si = 0; si < drawing.strokes.length; si++) {
        const stroke = drawing.strokes[si];
        if (!stroke || stroke.length === 0) continue;

        const segments = _buildSegments(stroke, ori, svgW, svgH);
        for (const { d, width } of segments) {
            const pxWidth = (width * MM_PER_UNIT).toFixed(4);
            paths.push(
                `<path id="sk_${si}" `
                + `style="fill:none;stroke:black;stroke-width:${pxWidth}" `
                + `d="${d}"/>`
            );
        }
    }

    return [
        `<?xml version="1.0" encoding="utf-8"?>`,
        `<svg xmlns="http://www.w3.org/2000/svg"`,
        `     width="${svgW}mm" height="${svgH}mm"`,
        `     viewBox="0 0 ${svgW.toFixed(3)} ${svgH.toFixed(3)}">`,
        `  <g id="layer0">`,
        ...paths.map(p => '    ' + p),
        `  </g>`,
        `</svg>`,
    ].join('\n');
}

function _buildSegments(points, ori, svgW, svgH) {
    // Transform + group points by stroke-width (matches JsonSvg._convert)
    const segments = [];
    let currentD    = null;
    let currentW    = null;

    for (const { x: rx, y: ry, p } of points) {
        if (!rx && !ry) continue;

        // Scale to output units
        let x = rx / OUTPUT_SCALING;
        let y = ry / OUTPUT_SCALING;

        // Orientation transform (mirrors export_win.py ImageExportBase.output_strokes)
        if (ori === 'reverse-portrait') {
            [x, y] = [y, svgH - x];
        } else if (ori === 'portrait') {
            [x, y] = [svgW - y, x];
        } else if (ori === 'reverse-landscape') {
            x = svgW - x;
            y = svgH - y;
        }
        // landscape = identity

        // Pressure → stroke width
        const delta = (p - 0x8000) / 0x8000;
        const rawW  = BASE_PEN_WIDTH + PRESSURE_FACTOR * delta;
        const w     = Math.round(rawW * WIDTH_PRECISION) / WIDTH_PRECISION;

        if (w !== currentW) {
            if (currentD !== null) {
                segments.push({ d: currentD, width: currentW });
            }
            currentD = `M ${x.toFixed(2)} ${y.toFixed(2)}`;
            currentW = w;
        } else {
            currentD += ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
        }
    }

    if (currentD !== null) {
        segments.push({ d: currentD, width: currentW });
    }
    return segments;
}

/**
 * Trigger a browser download of the SVG string.
 *
 * @param {string} svgString - SVG markup.
 * @param {string} filename  - Suggested filename (e.g. 'drawing_2024-01-15.svg').
 */
export function downloadSvg(svgString, filename) {
    downloadBlob(new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' }), filename);
}

/**
 * Trigger a browser download of an arbitrary Blob (PNG, PDF, …).
 *
 * @param {Blob}   blob     - File contents.
 * @param {string} filename - Suggested filename.
 */
export function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Longest side (in px) of the rendered raster used for PNG/PDF export.
const RASTER_MAX_PX = 2000;

// Output dimensions (device units / OUTPUT_SCALING), swapped for portrait.
function _outputDims(drawing, orientation) {
    const ori = orientation.toLowerCase();
    const [rawW, rawH] = (drawing.dimensions && drawing.dimensions[0])
        ? drawing.dimensions
        : [21000, 14800];
    const devW = rawW / OUTPUT_SCALING;
    const devH = rawH / OUTPUT_SCALING;
    return (ori === 'portrait' || ori === 'reverse-portrait')
        ? { w: devH, h: devW }
        : { w: devW, h: devH };
}

/**
 * Render a drawing to an offscreen <canvas> by rasterizing its SVG.
 *
 * @param {object}      drawing     - Drawing record.
 * @param {string}      orientation - Orientation string.
 * @param {string|null} background  - Fill colour, or null for transparent.
 * @returns {Promise<HTMLCanvasElement>}
 */
async function _rasterize(drawing, orientation, background) {
    const { w: dw, h: dh } = _outputDims(drawing, orientation);
    const scale = RASTER_MAX_PX / Math.max(dw, dh, 1);
    const w = Math.max(1, Math.round(dw * scale));
    const h = Math.max(1, Math.round(dh * scale));

    const svg = drawingToSvg(drawing, orientation);
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    const img = new Image();
    img.width = w;
    img.height = h;
    await new Promise((resolve, reject) => {
        img.onload  = resolve;
        img.onerror = () => reject(new Error('Failed to render drawing to image'));
        img.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width  = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (background) {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(img, 0, 0, w, h);
    return canvas;
}

/**
 * Convert a drawing to a PNG Blob (transparent background).
 *
 * @param {object} drawing     - Drawing record.
 * @param {string} orientation - Orientation string.
 * @returns {Promise<Blob>}
 */
export async function drawingToPngBlob(drawing, orientation = 'portrait') {
    const canvas = await _rasterize(drawing, orientation, null);
    return await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

/**
 * Convert a drawing to a single-page PDF Blob (white background).
 *
 * The drawing is rasterized to a JPEG and embedded in a minimal, hand-built
 * PDF — no external libraries, so it works under the static site's strict CSP.
 *
 * @param {object} drawing     - Drawing record.
 * @param {string} orientation - Orientation string.
 * @returns {Promise<Blob>}
 */
export async function drawingToPdfBlob(drawing, orientation = 'portrait') {
    const canvas = await _rasterize(drawing, orientation, '#ffffff');
    const jpegBytes = _dataUrlToBytes(canvas.toDataURL('image/jpeg', 0.92));

    // Page size in PDF points; SVG output units correspond to millimetres.
    const MM_TO_PT = 2.834645;
    const { w: dw, h: dh } = _outputDims(drawing, orientation);
    const pageW = (dw * MM_PER_UNIT * MM_TO_PT);
    const pageH = (dh * MM_PER_UNIT * MM_TO_PT);

    return _buildJpegPdf(jpegBytes, canvas.width, canvas.height, pageW, pageH);
}

function _dataUrlToBytes(dataUrl) {
    const b64 = dataUrl.split(',')[1];
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

// Assemble a minimal single-image PDF (JPEG via DCTDecode) with a valid xref.
function _buildJpegPdf(jpegBytes, imgW, imgH, pageW, pageH) {
    const enc = new TextEncoder();
    const chunks = [];
    let pos = 0;
    const offsets = {};

    const push = (data) => {
        const bytes = (typeof data === 'string') ? enc.encode(data) : data;
        chunks.push(bytes);
        pos += bytes.length;
    };
    const obj = (n, parts) => {
        offsets[n] = pos;
        push(`${n} 0 obj\n`);
        for (const p of parts) push(p);
        push('\nendobj\n');
    };

    const pw = pageW.toFixed(2);
    const ph = pageH.toFixed(2);

    push('%PDF-1.4\n');
    obj(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
    obj(2, ['<< /Type /Pages /Kids [3 0 R] /Count 1 >>']);
    obj(3, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] `
          + `/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`]);
    obj(4, [
        `<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} `
        + `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode `
        + `/Length ${jpegBytes.length} >>\nstream\n`,
        jpegBytes,
        '\nendstream',
    ]);
    const content = `q\n${pw} 0 0 ${ph} 0 0 cm\n/Im0 Do\nQ\n`;
    obj(5, [`<< /Length ${content.length} >>\nstream\n${content}\nendstream`]);

    const xrefPos = pos;
    const count = 6;
    let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
    for (let i = 1; i < count; i++) {
        xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    }
    push(xref);
    push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`);

    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return new Blob([out], { type: 'application/pdf' });
}
