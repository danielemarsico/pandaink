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
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
