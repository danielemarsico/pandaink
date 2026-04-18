// W8 — Canvas 2D rendering for offline drawings.
// Ports DrawingCanvas from tuhi_gui.py.
//
// Usage:
//   const canvas = new DrawingCanvas(canvasElement, drawing, orientation);
//   canvas.render();
//   canvas.setOrientation('portrait');   // re-render with new orientation

const NORMALIZED_RANGE = 0x10000;
const BASE_PEN_WIDTH   = 0.4;  // mm, matches export_win.py
const PRESSURE_FACTOR  = 0.2;

export class DrawingCanvas {
    /**
     * @param {HTMLCanvasElement} el         - The target <canvas> element.
     * @param {object}           drawing     - Drawing record from idb_store: { dimensions, strokes }
     * @param {string}           orientation - 'portrait' | 'landscape'
     */
    constructor(el, drawing, orientation = 'portrait') {
        this._el          = el;
        this._drawing     = drawing;
        this._orientation = orientation.toLowerCase();
        this._ctx         = el.getContext('2d');
    }

    setOrientation(orientation) {
        this._orientation = orientation.toLowerCase();
        this.render();
    }

    render() {
        const { el, ctx } = { el: this._el, ctx: this._ctx };
        const [devW, devH] = this._drawing.dimensions || [0, 0];

        // Canvas display dimensions respect orientation
        let canvasW = el.clientWidth  || el.width;
        let canvasH = el.clientHeight || el.height;

        // Set canvas buffer size to match display size
        el.width  = canvasW;
        el.height = canvasH;

        ctx.clearRect(0, 0, canvasW, canvasH);

        if (!this._drawing.strokes || this._drawing.strokes.length === 0) return;

        // Compute letterbox transform: fit device dimensions into canvas, preserving aspect ratio.
        const [srcW, srcH] = this._orientation === 'portrait'
            ? [devH || 14800, devW || 21000]
            : [devW || 21000, devH || 14800];

        const scale = Math.min(canvasW / srcW, canvasH / srcH);
        const offX  = (canvasW - srcW * scale) / 2;
        const offY  = (canvasH - srcH * scale) / 2;

        ctx.save();
        ctx.translate(offX, offY);
        ctx.scale(scale, scale);

        for (const stroke of this._drawing.strokes) {
            this._renderStroke(ctx, stroke, srcW, srcH);
        }

        ctx.restore();
    }

    _renderStroke(ctx, points, srcW, srcH) {
        if (!points || points.length < 2) return;

        let lastWidth = null;
        ctx.beginPath();

        for (let i = 0; i < points.length; i++) {
            let { x, y, p } = points[i];

            // Apply orientation transform (matches DrawingCanvas in tuhi_gui.py)
            if (this._orientation === 'portrait') {
                [x, y] = [srcW - y, x];
            } else if (this._orientation === 'reverse-landscape') {
                x = srcW - x;
                y = srcH - y;
            } else if (this._orientation === 'reverse-portrait') {
                [x, y] = [y, srcH - x];
            }

            // Pressure → line width (matches DrawingCanvas)
            const pressure  = p / NORMALIZED_RANGE;
            const lineWidth = pressure * 2 + 0.5;

            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                if (lineWidth !== lastWidth) {
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.moveTo(x, y);
                    ctx.lineWidth  = lineWidth;
                    ctx.strokeStyle = 'black';
                    ctx.lineCap    = 'round';
                    ctx.lineJoin   = 'round';
                }
                ctx.lineTo(x, y);
            }
            lastWidth = lineWidth;
        }

        ctx.stroke();
    }
}
