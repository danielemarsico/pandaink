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
     * @param {object}           drawing     - Drawing record from gdrive_store: { dimensions, strokes }
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
            this._renderStroke(ctx, stroke, srcW, srcH, scale);
        }

        ctx.restore();
    }

    _project(x, y, srcW, srcH) {
        // Orientation transform (matches DrawingCanvas in tuhi_gui.py)
        if (this._orientation === 'portrait') {
            return [srcW - y, x];
        } else if (this._orientation === 'reverse-landscape') {
            return [srcW - x, srcH - y];
        } else if (this._orientation === 'reverse-portrait') {
            return [y, srcH - x];
        }
        return [x, y]; // landscape = identity
    }

    _renderStroke(ctx, points, srcW, srcH, scale) {
        if (!points || points.length < 2) return;

        ctx.strokeStyle = 'black';
        ctx.lineCap     = 'round';
        ctx.lineJoin    = 'round';

        // Coordinates are in the same (µm) space as `dimensions`, which spans
        // hundreds of thousands of units, and the context is scaled by `scale`
        // (~0.0015) to fit the canvas. A line width given in those units would
        // therefore collapse to a sub-pixel — invisible — line. Express the
        // desired ON-SCREEN pixel width and divide by `scale` so the ctx.scale()
        // transform renders it at that pixel size.
        let [px, py] = this._project(points[0].x, points[0].y, srcW, srcH);
        ctx.beginPath();
        ctx.moveTo(px, py);
        let curWidth = null;

        for (let i = 1; i < points.length; i++) {
            const pressure = Math.min(1, Math.max(0, points[i].p / NORMALIZED_RANGE));
            const width    = (0.75 + pressure * 1.75) / scale;   // ~0.75–2.5 px on screen
            const [x, y]   = this._project(points[i].x, points[i].y, srcW, srcH);

            if (curWidth === null) curWidth = width;
            if (width !== curWidth) {
                ctx.lineWidth = curWidth;
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(px, py);
                curWidth = width;
            }
            ctx.lineTo(x, y);
            px = x; py = y;
        }

        ctx.lineWidth = curWidth ?? (1.5 / scale);
        ctx.stroke();
    }
}
