"""Crop an admitted image and write an observation PNG with source coordinates."""
import json
import math
import sys
import warnings
from PIL import Image, ImageOps

warnings.simplefilter("error", Image.DecompressionBombWarning)
Image.MAX_IMAGE_PIXELS = 40_000_000


def main():
    args = json.load(sys.stdin)
    region = args.get("region", [0, 0, 1, 1])
    if len(region) != 4 or any(not isinstance(v, (int, float)) or not math.isfinite(v) for v in region):
        raise ValueError("region requires four finite normalized coordinates")
    left, top, right, bottom = region
    if not (0 <= left < right <= 1 and 0 <= top < bottom <= 1):
        raise ValueError("region must be [left,top,right,bottom] within 0..1")
    zoom = args.get("zoom", 1)
    if not isinstance(zoom, (int, float)) or not math.isfinite(zoom) or not 1 <= zoom <= 4:
        raise ValueError("zoom must be 1..4")
    with Image.open(args["source"]) as image:
        image = ImageOps.exif_transpose(image)
        image.load()
        width, height = image.size
        box = [math.floor(left * width), math.floor(top * height), math.ceil(right * width), math.ceil(bottom * height)]
        crop = image.crop(box)
        factor = min(zoom, 2048 / max(crop.size))
        size = [max(1, round(v * factor)) for v in crop.size]
        if tuple(size) != crop.size:
            crop = crop.resize(size, Image.Resampling.LANCZOS)
        if crop.mode not in ("RGB", "RGBA"):
            crop = crop.convert("RGBA" if "transparency" in crop.info else "RGB")
        crop.save(args["output"], "PNG")
    print(json.dumps({"source_dimensions": [width, height], "pixel_region": box, "dimensions": size}))


if __name__ == "__main__":
    main()
