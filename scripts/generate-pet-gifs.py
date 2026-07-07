"""Generate pixel-art GIF pet assets for Husk terminal companion.

Creates 80x80 transparent GIFs with a simple pixel blob character:
- idle: breathing + blinking
- typing: alert ears/eyes
- success: happy jump
- failure: sad droop
- running: running on a wheel
- ci-pass: dancing with confetti

Frames are drawn as oversized pixels for a retro pixel-art look.
"""
from PIL import Image, ImageDraw
import os

OUT_DIR = os.path.join(os.path.dirname(__file__), "assets")
os.makedirs(OUT_DIR, exist_ok=True)

SIZE = 80
PIXEL = 4  # each logical pixel is 4x4 screen pixels

def new_frame():
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    return img

def rect(draw, x, y, w, h, fill):
    draw.rectangle([x, y, x + w - 1, y + h - 1], fill=fill)

def draw_blob(draw, body_color, eye_color, x_offset=0, y_offset=0, eye_open=True, mouth="neutral"):
    base_x = 20 + x_offset
    base_y = 24 + y_offset
    # body 40x32
    rect(draw, base_x, base_y, 40, 32, body_color)
    # rounded top corners (remove 4x4 squares)
    # top-left
    rect(draw, base_x, base_y, 8, 8, (0, 0, 0, 0))
    rect(draw, base_x + 8, base_y, 8, 8, body_color)
    rect(draw, base_x, base_y + 8, 8, 8, body_color)
    # top-right
    rect(draw, base_x + 32, base_y, 8, 8, (0, 0, 0, 0))
    rect(draw, base_x + 24, base_y, 8, 8, body_color)
    rect(draw, base_x + 32, base_y + 8, 8, 8, body_color)
    # bottom-left
    rect(draw, base_x, base_y + 24, 8, 8, (0, 0, 0, 0))
    rect(draw, base_x + 8, base_y + 24, 8, 8, body_color)
    rect(draw, base_x, base_y + 16, 8, 8, body_color)
    # bottom-right
    rect(draw, base_x + 32, base_y + 24, 8, 8, (0, 0, 0, 0))
    rect(draw, base_x + 24, base_y + 24, 8, 8, body_color)
    rect(draw, base_x + 32, base_y + 16, 8, 8, body_color)

    # eyes (white sclera + black pupil)
    eye_y = base_y + 10
    # left eye
    rect(draw, base_x + 8, eye_y, 10, 10, (255, 255, 255, 255))
    if eye_open:
        rect(draw, base_x + 12, eye_y + 3, 4, 4, (0, 0, 0, 255))
    else:
        # closed eye line
        rect(draw, base_x + 10, eye_y + 6, 6, 2, (0, 0, 0, 255))
    # right eye
    rect(draw, base_x + 22, eye_y, 10, 10, (255, 255, 255, 255))
    if eye_open:
        rect(draw, base_x + 26, eye_y + 3, 4, 4, (0, 0, 0, 255))
    else:
        rect(draw, base_x + 24, eye_y + 6, 6, 2, (0, 0, 0, 255))

    # mouth
    mouth_y = base_y + 24
    if mouth == "happy":
        rect(draw, base_x + 16, mouth_y, 8, 4, (0, 0, 0, 255))
        rect(draw, base_x + 12, mouth_y - 4, 4, 4, (0, 0, 0, 255))
        rect(draw, base_x + 24, mouth_y - 4, 4, 4, (0, 0, 0, 255))
    elif mouth == "sad":
        rect(draw, base_x + 16, mouth_y - 4, 8, 4, (0, 0, 0, 255))
        rect(draw, base_x + 12, mouth_y, 4, 4, (0, 0, 0, 255))
        rect(draw, base_x + 24, mouth_y, 4, 4, (0, 0, 0, 255))
    elif mouth == "surprise":
        rect(draw, base_x + 18, mouth_y - 2, 4, 6, (0, 0, 0, 255))
    elif mouth == "neutral":
        rect(draw, base_x + 16, mouth_y, 8, 2, (0, 0, 0, 255))

def save_gif(frames, filename, duration=120):
    path = os.path.join(OUT_DIR, filename)
    frames[0].save(
        path,
        save_all=True,
        append_images=frames[1:],
        duration=duration,
        loop=0,
        transparency=0,
        disposal=2,
    )
    print(f"Wrote {path}")

# Colors
BODY = (100, 160, 255, 255)
BODY_DARK = (70, 130, 220, 255)
WHITE = (255, 255, 255, 255)
BLACK = (0, 0, 0, 255)
GREEN = (80, 220, 120, 255)
RED = (255, 100, 100, 255)
YELLOW = (255, 220, 80, 255)

# idle: breathing + blinking
frames = []
for i in range(4):
    img = new_frame()
    draw = ImageDraw.Draw(img)
    y_off = 0 if i % 2 == 0 else 2
    eye_open = i != 2
    draw_blob(draw, BODY, WHITE, y_offset=y_off, eye_open=eye_open, mouth="neutral")
    frames.append(img)
save_gif(frames, "pet-idle.gif", duration=250)

# typing: alert, ears/antenna up, watching
frames = []
for i in range(4):
    img = new_frame()
    draw = ImageDraw.Draw(img)
    # antenna
    rect(draw, 36, 8, 8, 12, BODY)
    rect(draw, 34, 4, 12, 4, (255, 220, 80, 255))
    # body slightly lower
    draw_blob(draw, BODY, WHITE, y_offset=6, eye_open=True, mouth="surprise")
    # pupils shift left/right
    frames.append(img)
save_gif(frames, "pet-typing.gif", duration=200)

# success: happy jump
frames = []
for i, (y_off, mouth) in enumerate([(8, "happy"), (0, "happy"), (-4, "happy"), (0, "happy")]):
    img = new_frame()
    draw = ImageDraw.Draw(img)
    draw_blob(draw, GREEN, WHITE, y_offset=y_off, eye_open=True, mouth=mouth)
    # sparkles
    rect(draw, 12, 40 + y_off, 4, 4, YELLOW)
    rect(draw, 64, 32 + y_off, 4, 4, YELLOW)
    frames.append(img)
save_gif(frames, "pet-success.gif", duration=150)

# failure: sad droop with sweat drop
frames = []
for i in range(4):
    img = new_frame()
    draw = ImageDraw.Draw(img)
    y_off = 4 if i % 2 == 0 else 6
    draw_blob(draw, RED, WHITE, y_offset=y_off, eye_open=i != 2, mouth="sad")
    # sweat drop
    rect(draw, 58, 28 + y_off, 8, 8, (120, 200, 255, 255))
    rect(draw, 60, 24 + y_off, 4, 4, (120, 200, 255, 255))
    frames.append(img)
save_gif(frames, "pet-failure.gif", duration=250)

# running: on wheel
frames = []
for i in range(4):
    img = new_frame()
    draw = ImageDraw.Draw(img)
    y_off = 0 if i % 2 == 0 else 4
    # wheel
    wheel_color = (120, 120, 120, 255)
    rect(draw, 12, 52, 56, 8, wheel_color)
    rect(draw, 16, 48, 48, 16, (0, 0, 0, 0))  # inner
    rect(draw, 20, 56, 40, 4, wheel_color)
    # legs
    leg_color = BODY_DARK
    rect(draw, 24, 56 + y_off, 8, 8, leg_color)
    rect(draw, 48, 56 + y_off, 8, 8, leg_color)
    draw_blob(draw, BODY, WHITE, y_offset=-4 + y_off, eye_open=True, mouth="neutral")
    frames.append(img)
save_gif(frames, "pet-running.gif", duration=120)

# ci-pass: dancing with confetti
frames = []
for i in range(6):
    img = new_frame()
    draw = ImageDraw.Draw(img)
    y_off = 0 if i % 2 == 0 else -6
    x_off = 0 if i % 2 == 0 else 6
    draw_blob(draw, GREEN, WHITE, x_offset=x_off, y_offset=y_off, eye_open=True, mouth="happy")
    # arms up
    rect(draw, 12 + x_off, 32 + y_off, 8, 12, BODY)
    rect(draw, 60 + x_off, 28 + y_off, 8, 12, BODY)
    # confetti
    confetti_positions = [(10, 12), (70, 8), (60, 60), (20, 66), (50, 14)]
    for j, (cx, cy) in enumerate(confetti_positions):
        color = [GREEN, YELLOW, RED, WHITE, BODY][j % 5]
        rect(draw, cx + (i * 2) % 8 - 4, cy, 4, 4, color)
    frames.append(img)
save_gif(frames, "pet-ci-pass.gif", duration=120)

print("Done.")
