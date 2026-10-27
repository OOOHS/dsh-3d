"""Observation-only image feedback. Blender owns the geometry and editing state.

Raw screenshot pixels stay in display space; diagnostic PNGs never become renders.
Uses Blender's bundled numpy and image reader, with a small lossless PNG writer.
"""
from pathlib import Path
import math
import struct
import zlib

import bpy
import numpy as np


def pixels(path):
    image = bpy.data.images.load(str(path), check_existing=False)
    try:
        # Read the PNG's display bytes, without a second color-management pass.
        image.colorspace_settings.name = 'Non-Color'
        width, height = image.size
        data = np.empty(width * height * 4, dtype=np.float32)
        image.pixels.foreach_get(data)
        return np.clip(np.rint(data.reshape(height, width, 4)[::-1] * 255), 0, 255).astype(np.uint8)
    finally:
        bpy.data.images.remove(image)


def save_png(path, data):
    height, width, _ = data.shape
    def chunk(kind, value):
        return struct.pack('!I', len(value)) + kind + value + struct.pack('!I', zlib.crc32(kind + value) & 0xffffffff)
    rows = b''.join(b'\0' + row.tobytes() for row in data)
    Path(path).write_bytes(b'\x89PNG\r\n\x1a\n' +
        chunk(b'IHDR', struct.pack('!2I5B', width, height, 8, 6, 0, 0, 0)) +
        chunk(b'IDAT', zlib.compress(rows, 6)) + chunk(b'IEND', b''))
    return {'path': str(path), 'width': width, 'height': height, 'kind': 'diagnostic'}


def line(data, a, b, color, thickness=2):
    height, width = data.shape[:2]
    # Clip before allocating samples; native world-unit brush radii can be huge.
    a, b = np.asarray(a,dtype=float), np.asarray(b,dtype=float)
    if not np.isfinite([a,b]).all():
        return
    delta = b-a
    start, end = 0.0, 1.0
    for p,q in [(-delta[0],a[0]),(delta[0],width-1-a[0]),(-delta[1],a[1]),(delta[1],height-1-a[1])]:
        if p == 0:
            if q < 0:
                return
        elif p < 0:
            start = max(start,q/p)
        else:
            end = min(end,q/p)
    if start > end:
        return
    a,b = a+start*delta, a+end*delta
    n = max(2, int(max(abs(b[0]-a[0]), abs(b[1]-a[1])))+1)
    xy = np.rint(np.linspace(a, b, n)).astype(int)
    for dx in range(-thickness//2, thickness//2+1):
        for dy in range(-thickness//2, thickness//2+1):
            x, y = xy[:, 0]+dx, xy[:, 1]+dy
            valid = (x >= 0) & (x < width) & (y >= 0) & (y < height)
            data[y[valid], x[valid]] = color


def circle(data, center, radius, color):
    if not math.isfinite(radius) or radius < 0:
        return
    angles = np.linspace(0, math.tau, max(32, min(1024, int(2*math.pi*radius))))
    pts = np.column_stack((center[0]+radius*np.cos(angles), center[1]+radius*np.sin(angles)))
    for a, b in zip(pts, pts[1:]):
        line(data, a, b, color, 1)


FONT = {
    'A': ['01110','10001','10001','11111','10001','10001','10001'],
    'B': ['11110','10001','10001','11110','10001','10001','11110'],
    'E': ['11111','10000','10000','11110','10000','10000','11111'],
    'F': ['11111','10000','10000','11110','10000','10000','10000'],
    'O': ['01110','10001','10001','10001','10001','10001','01110'],
    'R': ['11110','10001','10001','11110','10100','10010','10001'],
    'T': ['11111','00100','00100','00100','00100','00100','00100'],
}


def label(data, word, left, top=6):
    for n, char in enumerate(word):
        for y, row in enumerate(FONT[char]):
            for x, value in enumerate(row):
                if value == '1':
                    data[top+y*2:top+y*2+2, left+n*12+x*2:left+n*12+x*2+2] = [245,245,245,255]


def aim_overlay(view, probes, path, points=None, radius=None):
    data = pixels(view['path'])
    height, width = data.shape[:2]
    points = points or [p['point'] for p in probes]
    xy = [(p[0]*width, p[1]*height) for p in points]
    for a, b in zip(xy, xy[1:]):
        line(data, a, b, [255,205,35,255])
    if len(xy) > 1:
        delta = np.array(xy[-1])-np.array(xy[-2])
        length = np.linalg.norm(delta)
        if length > 1:
            direction = delta/length
            normal = np.array([-direction[1],direction[0]])
            for sign in (-1,1):
                line(data, xy[-1], np.array(xy[-1])-direction*12+normal*sign*6, [255,205,35,255])
    for i, p in enumerate(xy):
        color = [30,240,100,255] if i < len(probes) and probes[i]['target'] else [255,60,65,255]
        circle(data, p, 5, color)
        line(data, (p[0]-7,p[1]), (p[0]+7,p[1]), color, 1)
        line(data, (p[0],p[1]-7), (p[0],p[1]+7), color, 1)
    if xy and radius is not None:
        circle(data, xy[0], radius*width, [30,225,255,255])
    return {**save_png(path, data), 'purpose': 'aiming_preview', 'source_view_id': view['view_id'],
            'legend': 'Green: target hit; red: other object/background; yellow: input path; cyan: nominal radius at the start before pressure/falloff.',
            'coordinates': 'Same normalized top-left coordinates as the viewport.'}


def comparison(before, after, bounds, path):
    a, b = pixels(before['path']), pixels(after['path'])
    if a.shape != b.shape or before['rotation'] != after['rotation'] or before['location'] != after['location'] or before['distance'] != after['distance']:
        raise ValueError('Comparison requires the same viewport, framing and image dimensions.')
    height, width = a.shape[:2]
    left, top, right, bottom = bounds or [0,0,1,1]
    left, top = max(0, math.floor(left*width)), max(0, math.floor(top*height))
    right, bottom = min(width, math.ceil(right*width)), min(height, math.ceil(bottom*height))
    # Minimum context makes small edits readable without inventing image detail.
    pad = max(12, round(max(right-left, bottom-top)*.12))
    left, top, right, bottom = max(0,left-pad), max(0,top-pad), min(width,right+pad), min(height,bottom+pad)
    if right <= left or bottom <= top:
        left, top, right, bottom = 0,0,width,height
    cw, ch = right-left, bottom-top
    scale = min(3, 512/max(cw,ch))
    ow, oh = max(96,round(cw*scale)), max(1,round(ch*scale))
    # Preserve aspect ratio, including for a narrow change region.
    oh = max(1, round(ch*ow/cw))
    if oh > 512:
        oh, ow = 512, max(1,round(cw*512/ch))
    x, y = np.minimum(cw-1,(np.arange(ow)*cw/ow).astype(int)), np.minimum(ch-1,(np.arange(oh)*ch/oh).astype(int))
    canvas = np.full((oh+26,ow*2+8,4), [28,30,34,255], dtype=np.uint8)
    for source, offset in [(a,0),(b,ow+8)]:
        canvas[26:,offset:offset+ow] = source[top:bottom,left:right][y[:,None],x[None,:]]
    if ow >= 80:
        label(canvas, 'BEFORE', 4)
        label(canvas, 'AFTER', ow+12)
    return {**save_png(path,canvas), 'purpose': 'before_after_detail',
            'panels': ['before (left)', 'after (right)'],
            'before_view_id': before['view_id'], 'after_view_id': after['view_id'],
            'crop_pixels': [left,top,right,bottom], 'source_pixels': [width,height],
            'crop_normalized': [left/width,top/height,right/width,bottom/height],
            'coordinates': 'Aim using the full viewport image. Detail panels share this crop and are enlarged together.'}
