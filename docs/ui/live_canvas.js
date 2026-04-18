// W9 — Real-time stroke rendering on Canvas 2D.
// Ports LiveCanvas from tuhi_gui.py.
//
// Usage:
//   const lc = new LiveCanvas(canvasElement, { orientation: 'portrait', dimensions: [21000, 14800] });
//   lc.onPenPoint(x, y, pressure, inProximity);   // call from live.js callback
//   lc.clear();                                    // reset between sessions
//   lc.setOrientation('landscape');

const NORMALIZED_RANGE = 0x10000;

export class LiveCanvas {
    /**
     * @param {HTMLCanvasElement} el
     * @param {object} opts
     * @param {string} [opts.orientation='portrait']
     * @param {number[]} [opts.dimensions=[21000,14800]] - Device width/height in device units.
     */
    constructor(el, opts = {}) {
        this._el          = el;
        this._ctx         = el.getContext('2d');
        this._orientation = (opts.orientation || 'portrait').toLowerCase();
        this._dimensions  = opts.dimensions || [21000, 14800];

        this._currentSegment = [];  // points in the current pen-down stroke
        this._segments       = [];  // all completed segments

        this._resize();
        window.addEventListener('resize', () => this._resize());
    }

    setOrientation(orientation) {
        this._orientation = orientation.toLowerCase();
        this._redraw();
    }

    setDimensions(dimensions) {
        this._dimensions = dimensions;
        this._redraw();
    }

    clear() {
        this._segments       = [];
        this._currentSegment = [];
        const { el, ctx } = { el: this._el, ctx: this._ctx };
        ctx.clearRect(0, 0, el.width, el.height);
    }

    onPenPoint(x, y, pressure, inProximity) {
        if (!inProximity) {
            if (this._currentSegment.length) {
                this._segments.push(this._currentSegment);
                this._currentSegment = [];
            }
            return;
        }

        const pt = { x, y, p: pressure };
        this._currentSegment.push(pt);

        // Incremental render: draw only the new segment from the last confirmed point.
        if (this._currentSegment.length >= 2) {
            const prev = this._currentSegment[this._currentSegment.length - 2];
            const curr = pt;
            this._drawSegment(prev, curr);
        }
    }

    // ─── Private ─────────────────────────────────────────────────────────────

    _resize() {
        const el = this._el;
        el.width  = el.clientWidth  || el.width;
        el.height = el.clientHeight || el.height;
        this._redraw();
    }

    _redraw() {
        const { el, ctx } = { el: this._el, ctx: this._ctx };
        ctx.clearRect(0, 0, el.width, el.height);

        const allSegs = [...this._segments];
        if (this._currentSegment.length) allSegs.push(this._currentSegment);

        for (const seg of allSegs) {
            for (let i = 1; i < seg.length; i++) {
                this._drawSegment(seg[i - 1], seg[i]);
            }
        }
    }

    _transform(x, y) {
        const [devW, devH] = this._dimensions;
        const { el }       = { el: this._el };
        const canvasW = el.width;
        const canvasH = el.height;

        // Source dimensions after orientation swap
        const [srcW, srcH] = this._orientation === 'portrait'
            ? [devH, devW]
            : [devW, devH];

        const scale = Math.min(canvasW / srcW, canvasH / srcH);
        const offX  = (canvasW - srcW * scale) / 2;
        const offY  = (canvasH - srcH * scale) / 2;

        let tx = x, ty = y;
        if (this._orientation === 'portrait') {
            [tx, ty] = [devW - y, x];
        } else if (this._orientation === 'reverse-landscape') {
            tx = devW - x; ty = devH - y;
        } else if (this._orientation === 'reverse-portrait') {
            [tx, ty] = [y, devH - x];
        }

        return [offX + tx * scale, offY + ty * scale];
    }

    _drawSegment(p1, p2) {
        const ctx = this._ctx;
        const [x1, y1] = this._transform(p1.x, p1.y);
        const [x2, y2] = this._transform(p2.x, p2.y);

        const pressure  = ((p1.p + p2.p) / 2) / NORMALIZED_RANGE;
        const lineWidth = pressure * 2 + 0.5;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.lineWidth   = lineWidth;
        ctx.strokeStyle = 'black';
        ctx.lineCap     = 'round';
        ctx.lineJoin    = 'round';
        ctx.stroke();
    }
}
