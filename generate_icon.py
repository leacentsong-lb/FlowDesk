#!/usr/bin/env python3
"""
Generate Dev Helper app icon with a modern developer aesthetic
"""

from PIL import Image, ImageDraw
import os

def create_icon(size):
    """Create a modern dev helper icon"""
    # Create image with transparent background
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Calculate dimensions
    padding = int(size * 0.08)
    corner_radius = int(size * 0.2)
    
    # Colors
    bg_color = (99, 102, 241, 255)  # Indigo-500
    highlight_color = (129, 140, 248, 80)  # Lighter indigo
    symbol_color = (255, 255, 255, 255)  # White
    accent_color = (52, 211, 153, 255)  # Emerald-400
    
    # Draw main rounded rectangle background
    x1, y1 = padding, padding
    x2, y2 = size - padding, size - padding
    
    # Use rounded_rectangle if available (Pillow 8.2+)
    try:
        draw.rounded_rectangle([x1, y1, x2, y2], radius=corner_radius, fill=bg_color)
    except AttributeError:
        # Fallback for older Pillow versions
        draw.rectangle([x1, y1, x2, y2], fill=bg_color)
    
    # Draw the code bracket symbols < / >
    center_x = size / 2
    center_y = size / 2
    
    stroke_width = max(int(size * 0.055), 2)
    
    # Left bracket <
    bracket_width = size * 0.14
    bracket_height = size * 0.22
    left_x = center_x - size * 0.2
    
    # Draw < symbol
    points_left = [
        (left_x + bracket_width, center_y - bracket_height),
        (left_x, center_y),
        (left_x + bracket_width, center_y + bracket_height)
    ]
    draw.line(points_left[0:2], fill=symbol_color, width=stroke_width)
    draw.line(points_left[1:3], fill=symbol_color, width=stroke_width)
    
    # Right bracket >
    right_x = center_x + size * 0.2
    
    # Draw > symbol
    points_right = [
        (right_x - bracket_width, center_y - bracket_height),
        (right_x, center_y),
        (right_x - bracket_width, center_y + bracket_height)
    ]
    draw.line(points_right[0:2], fill=symbol_color, width=stroke_width)
    draw.line(points_right[1:3], fill=symbol_color, width=stroke_width)
    
    # Draw / in the middle
    slash_height = size * 0.2
    slash_offset = size * 0.05
    draw.line(
        [(center_x + slash_offset, center_y - slash_height),
         (center_x - slash_offset, center_y + slash_height)],
        fill=symbol_color, width=stroke_width
    )
    
    # Add a small accent dot (like a cursor blinking)
    if size >= 64:
        dot_radius = max(int(size * 0.025), 2)
        dot_x = int(center_x + size * 0.12)
        dot_y = int(center_y + size * 0.16)
        draw.ellipse(
            [dot_x - dot_radius, dot_y - dot_radius, 
             dot_x + dot_radius, dot_y + dot_radius],
            fill=accent_color
        )
    
    return img


def main():
    # Output directory
    output_dir = 'src-tauri/icons'
    
    # Generate icons in required sizes
    sizes = {
        '32x32.png': 32,
        '128x128.png': 128,
        '128x128@2x.png': 256,
        '256x256.png': 256,
    }
    
    print("🎨 Generating Dev Helper icons...")
    
    for filename, size in sizes.items():
        icon = create_icon(size)
        output_path = os.path.join(output_dir, filename)
        icon.save(output_path, 'PNG')
        print(f"  ✓ {filename}")
    
    # Generate icon.ico for Windows
    icon_sizes = [16, 32, 48, 256]
    ico_images = [create_icon(s) for s in icon_sizes]
    ico_path = os.path.join(output_dir, 'icon.ico')
    ico_images[0].save(ico_path, format='ICO', sizes=[(s, s) for s in icon_sizes], 
                       append_images=ico_images[1:])
    print(f"  ✓ icon.ico")
    
    # Generate icon.icns for macOS using iconset
    iconset_dir = os.path.join(output_dir, 'icon.iconset')
    os.makedirs(iconset_dir, exist_ok=True)
    
    icns_sizes = {
        'icon_16x16.png': 16,
        'icon_16x16@2x.png': 32,
        'icon_32x32.png': 32,
        'icon_32x32@2x.png': 64,
        'icon_128x128.png': 128,
        'icon_128x128@2x.png': 256,
        'icon_256x256.png': 256,
        'icon_256x256@2x.png': 512,
        'icon_512x512.png': 512,
        'icon_512x512@2x.png': 1024,
    }
    
    for filename, size in icns_sizes.items():
        icon = create_icon(size)
        output_path = os.path.join(iconset_dir, filename)
        icon.save(output_path, 'PNG')
    
    print(f"  ✓ iconset folder created")
    print(f"\n📦 Converting iconset to icns...")


if __name__ == '__main__':
    main()
