#!/usr/bin/env python3
#
#  Windows-compatible export module.
#  Uses svgwrite for SVG (cross-platform) and Pillow for PNG
#  (instead of pycairo which requires GTK/GLib on Windows).
#

import svgwrite
from svgwrite import mm


class ImageExportBase:

    def __init__(self, json_data, orientation, filename, *args, **kwargs):
        self.json = json_data
        self.timestamp = json_data['timestamp']
        self.filename = filename
        self.orientation = orientation.lower()
        self._convert()

    @property
    def output_dimensions(self):
        dimensions = self.json['dimensions']
        if dimensions == [0, 0]:
            width, height = 100, 100
        else:
            width = dimensions[0] / self._output_scaling_factor
            height = dimensions[1] / self._output_scaling_factor

        if self.orientation in ['portrait', 'reverse-portrait']:
            return height, width
        else:
            return width, height

    @property
    def output_strokes(self):
        width, height = self.output_dimensions
        strokes = []

        for s in self.json['strokes']:
            points_with_sk_width = []
            for p in s['points']:
                x, y = p['position']
                x = x / self._output_scaling_factor
                y = y / self._output_scaling_factor

                if self.orientation == 'reverse-portrait':
                    x, y = y, height - x
                elif self.orientation == 'portrait':
                    x, y = width - y, x
                elif self.orientation == 'reverse-landscape':
                    x, y = width - x, height - y

                delta = (p['pressure'] - 0x8000) / 0x8000
                stroke_width = self._base_pen_width + self._pen_pressure_width_factor * delta
                points_with_sk_width.append((x, y, stroke_width))

            strokes.append(points_with_sk_width)

        return strokes


class JsonSvg(ImageExportBase):

    _output_scaling_factor = 1000
    _base_pen_width = 0.4
    _pen_pressure_width_factor = 0.2
    _width_precision = 10

    def _convert(self):
        width, height = self.output_dimensions
        size = width * mm, height * mm
        svg = svgwrite.Drawing(filename=self.filename, size=size,
                               viewBox=(f'0 0 {width} {height}'))

        g = svgwrite.container.Group(id='layer0')
        for sk_num, stroke_points in enumerate(self.output_strokes):
            path = None
            stroke_width_p = None
            for i, (x, y, stroke_width) in enumerate(stroke_points):
                if not x or not y:
                    continue
                stroke_width = int(stroke_width * self._width_precision) / self._width_precision
                if stroke_width_p != stroke_width:
                    if path:
                        g.add(path)
                    width_px = stroke_width * 0.26458
                    path = svg.path(id=f'sk_{sk_num}_{i}',
                                    style=f'fill:none;stroke:black;stroke-width:{width_px}')
                    stroke_width_p = stroke_width
                    path.push("M", f'{x:.2f}', f'{y:.2f}')
                else:
                    path.push("L", f'{x:.2f}', f'{y:.2f}')
            if path:
                g.add(path)

        svg.add(g)
        svg.save()


class JsonPng(ImageExportBase):
    """PNG export using Pillow instead of pycairo."""

    _output_scaling_factor = 100
    _base_pen_width = 3
    _pen_pressure_width_factor = 1

    def _convert(self):
        try:
            from PIL import Image, ImageDraw
        except ImportError:
            raise ImportError(
                'Pillow is required for PNG export on Windows. '
                'Install with: pip install Pillow'
            )

        width, height = self.output_dimensions
        width, height = int(width), int(height)

        image = Image.new('RGBA', (width, height), (0, 0, 0, 0))
        draw = ImageDraw.Draw(image)

        for sk_num, stroke_points in enumerate(self.output_strokes):
            for i in range(1, len(stroke_points)):
                x1, y1, sw1 = stroke_points[i - 1]
                x2, y2, sw2 = stroke_points[i]
                avg_width = (sw1 + sw2) / 2
                draw.line([(x1, y1), (x2, y2)], fill='black',
                          width=max(1, int(avg_width)))

        image.save(self.filename)
