// W8 — Canvas 2D rendering for offline drawings.
// Ports DrawingCanvas from tuhi_gui.py.
//
// Usage:
//   const canvas = new DrawingCanvas(canvasElement, drawing, orientation);
//   canvas.render();
//   canvas.setOrientation('portrait');       // re-render with new orientation
//   canvas.setLineWidthFactor(0.6);          // thinner / bolder strokes
//   canvas.zoomBy(1.25);                     // zoom about the canvas centre
//   canvas.resetView();                      // back to fit-to-canvas, no pan
//
// The view transform is: pan → zoom → letterbox fit → device coordinates.
// Stroke widths are expressed in ON-SCREEN pixels and divided by the total
// scale, so a stroke keeps the same apparent thickness at any zoom level —
// zooming in makes the handwriting bigger without making the ink fatter.

const NORMALIZED_RANGE = 0x10000;

// Default stroke thickness on screen, in CSS pixels, at pressure 0 and 1.
// Multiplied by the user's line-width factor (see setLineWidthFactor).
const MIN_PEN_PX = 0.75;
const MAX_PEN_PX = 2.5;

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 16;

export class DrawingCanvas {
    /**
     * @param {HTMLCanvasElement} el         - The target <canvas> element.
     * @param {object}           drawing     - Drawing record from the store: { dimensions, strokes }
     * @param {string}           orientation - 'portrait' | 'landscape'
     * @param {object}           [opts]
     * @param {number}           [opts.lineWidthFactor=1] - Stroke thickness multiplier.
     * @param {object}           [opts.view]              - Zoom/pan to restore, from getView().
     */
    constructor(el, drawing, orientation = 'portrait', opts = {}) {
        this._el          = el;
        this._drawing     = drawing;
        this._orientation = orientation.toLowerCase();
        this._ctx         = el.getContext('2d');

        this._widthFactor = opts.lineWidthFactor ?? 1;
        this._zoom        = opts.view?.zoom ?? 1;
        this._panX        = opts.view?.panX ?? 0;
        this._panY        = opts.view?.panY ?? 0;

        // Called after zoom changes so the UI can update its "120%" label.
        this.onZoomChange = null;

        this._bindPointer();
        this._onResize = () => this.render();
        window.addEventListener('resize', this._onResize);
    }

    /** Detach listeners — call before dropping the instance (tab switch). */
    destroy() {
        window.removeEventListener('resize', this._onResize);
    }

    setOrientation(orientation) {
        this._orientation = orientation.toLowerCase();
        this.render();
    }

    /** Stroke thickness multiplier (1 = the original thickness). */
    setLineWidthFactor(factor) {
        this._widthFactor = factor;
        this.render();
    }

    getZoom() { return this._zoom; }

    /** Current zoom/pan, so a re-rendered tab can pick up where it left off. */
    getView() { return { zoom: this._zoom, panX: this._panX, panY: this._panY }; }

    /**
     * Multiply the zoom by `factor`, keeping the point (cx, cy) — in CSS pixels
     * relative to the canvas — visually fixed. Defaults to the canvas centre.
     */
    zoomBy(factor, cx = null, cy = null) {
        const el = this._el;
        const w  = el.clientWidth  || el.width;
        const h  = el.clientHeight || el.height;
        if (cx === null) cx = w / 2;
        if (cy === null) cy = h / 2;

        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this._zoom * factor));
        if (next === this._zoom) return;

        // Keep the content point under (cx, cy) in place:
        //   pan' = c - (z'/z) * (c - pan)
        const ratio = next / this._zoom;
        this._panX = cx - ratio * (cx - this._panX);
        this._panY = cy - ratio * (cy - this._panY);
        this._zoom = next;

        this.render();
        if (this.onZoomChange) this.onZoomChange(this._zoom);
    }

    /** Back to fit-to-canvas with no panning. */
    resetView() {
        this._zoom = 1;
        this._panX = 0;
        this._panY = 0;
        this.render();
        if (this.onZoomChange) this.onZoomChange(this._zoom);
    }

    render() {
        const el  = this._el;
        const ctx = this._ctx;
        const [devW, devH] = this._drawing.dimensions || [0, 0];

        // CSS pixel size of the element; the backing buffer is scaled by the
        // device pixel ratio so strokes stay crisp on HiDPI screens.
        const cssW = el.clientWidth  || el.width;
        const cssH = el.clientHeight || el.height;
        const dpr  = window.devicePixelRatio || 1;

        el.width  = Math.round(cssW * dpr);
        el.height = Math.round(cssH * dpr);

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cssW, cssH);

        if (!this._drawing.strokes || this._drawing.strokes.length === 0) return;

        // Letterbox transform: fit device dimensions into the canvas, preserving
        // aspect ratio.
        const [srcW, srcH] = this._orientation === 'portrait'
            ? [devH || 14800, devW || 21000]
            : [devW || 21000, devH || 14800];

        const fit  = Math.min(cssW / srcW, cssH / srcH);
        const offX = (cssW - srcW * fit) / 2;
        const offY = (cssH - srcH * fit) / 2;

        ctx.save();
        ctx.translate(this._panX, this._panY);
        ctx.scale(this._zoom, this._zoom);
        ctx.translate(offX, offY);
        ctx.scale(fit, fit);

        // Total device-units → CSS-pixels scale, used to keep pen widths
        // constant in screen pixels.
        const scale = fit * this._zoom;

        for (const stroke of this._drawing.strokes) {
            this._renderStroke(ctx, stroke, srcW, srcH, scale);
        }

        ctx.restore();
    }

    // ─── Private ─────────────────────────────────────────────────────────────

    // Wheel to zoom about the cursor, drag to pan, double-click to reset.
    _bindPointer() {
        const el = this._el;

        el.addEventListener('wheel', (e) => {
            e.preventDefault();
            const rect = el.getBoundingClientRect();
            this.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15,
                        e.clientX - rect.left, e.clientY - rect.top);
        }, { passive: false });

        el.addEventListener('pointerdown', (e) => {
            this._dragging = { x: e.clientX, y: e.clientY, id: e.pointerId };
            el.setPointerCapture(e.pointerId);
            el.classList.add('dragging');
        });

        el.addEventListener('pointermove', (e) => {
            if (!this._dragging || this._dragging.id !== e.pointerId) return;
            this._panX += e.clientX - this._dragging.x;
            this._panY += e.clientY - this._dragging.y;
            this._dragging.x = e.clientX;
            this._dragging.y = e.clientY;
            this.render();
        });

        const endDrag = (e) => {
            if (!this._dragging || this._dragging.id !== e.pointerId) return;
            this._dragging = null;
            el.classList.remove('dragging');
        };
        el.addEventListener('pointerup',     endDrag);
        el.addEventListener('pointercancel', endDrag);

        el.addEventListener('dblclick', () => this.resetView());
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
        const minPx = MIN_PEN_PX * this._widthFactor;
        const spanPx = (MAX_PEN_PX - MIN_PEN_PX) * this._widthFactor;

        let [px, py] = this._project(points[0].x, points[0].y, srcW, srcH);
        ctx.beginPath();
        ctx.moveTo(px, py);
        let curWidth = null;

        for (let i = 1; i < points.length; i++) {
            const pressure = Math.min(1, Math.max(0, points[i].p / NORMALIZED_RANGE));
            const width    = (minPx + pressure * spanPx) / scale;
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

        ctx.lineWidth = curWidth ?? ((minPx + spanPx / 2) / scale);
        ctx.stroke();
    }
}
