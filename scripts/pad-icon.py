#!/usr/bin/env python3
from PIL import Image
import sys

src = sys.argv[1] if len(sys.argv) > 1 else "public/logo.png"
dst = sys.argv[2] if len(sys.argv) > 2 else "public/logo-padded.png"
scale = float(sys.argv[3]) if len(sys.argv) > 3 else 0.82

img = Image.open(src).convert("RGBA")
w, h = img.size

# Create a same-size transparent canvas
canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))

# Scale down the logo
new_w = int(w * scale)
new_h = int(h * scale)
resized = img.resize((new_w, new_h), Image.LANCZOS)

# Center it
x = (w - new_w) // 2
y = (h - new_h) // 2
canvas.paste(resized, (x, y), resized)
canvas.save(dst)
print(f"Saved {dst} — logo scaled to {scale*100:.0f}% ({new_w}x{new_h}) on {w}x{h} canvas")
