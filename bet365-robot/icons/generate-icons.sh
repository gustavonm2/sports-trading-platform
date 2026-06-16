#!/bin/bash
# Generate simple robot icons using Python
cd "$(dirname "$0")"

python3 << 'PYTHON'
import struct
import zlib

def create_png(size, filename):
    """Create a simple robot icon PNG."""
    pixels = []
    center = size // 2
    
    for y in range(size):
        row = []
        for x in range(size):
            # Background circle
            dx = x - center
            dy = y - center
            dist = (dx**2 + dy**2) ** 0.5
            radius = size * 0.45
            
            if dist <= radius:
                # Inside circle - gradient green to blue
                t = x / size
                r = int(16 * (1-t) + 59 * t)
                g = int(185 * (1-t) + 130 * t)
                b = int(129 * (1-t) + 246 * t)
                a = 255
                
                # Robot face features
                eye_radius = size * 0.08
                eye_y = center - size * 0.08
                left_eye_x = center - size * 0.15
                right_eye_x = center + size * 0.15
                
                # Eyes
                left_dist = ((x - left_eye_x)**2 + (y - eye_y)**2) ** 0.5
                right_dist = ((x - right_eye_x)**2 + (y - eye_y)**2) ** 0.5
                
                if left_dist <= eye_radius or right_dist <= eye_radius:
                    r, g, b = 255, 255, 255
                
                # Mouth (horizontal line)
                mouth_y = center + size * 0.12
                if abs(y - mouth_y) < size * 0.03 and abs(x - center) < size * 0.18:
                    r, g, b = 255, 255, 255
                
                # Antenna
                if abs(x - center) < size * 0.04 and y < center - size * 0.25 and y > center - size * 0.40:
                    r, g, b = 200, 220, 255
                
                # Antenna tip
                tip_dist = ((x - center)**2 + (y - (center - size * 0.40))**2) ** 0.5
                if tip_dist <= size * 0.06:
                    r, g, b = 16, 185, 129
                
                row.extend([r, g, b, a])
            else:
                row.extend([0, 0, 0, 0])
        
        pixels.append(bytes([0] + row))  # Filter byte = 0 (None)
    
    raw = b''.join(pixels)
    
    def chunk(chunk_type, data):
        c = chunk_type + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    
    header = b'\x89PNG\r\n\x1a\n'
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
    idat = chunk(b'IDAT', zlib.compress(raw))
    iend = chunk(b'IEND', b'')
    
    with open(filename, 'wb') as f:
        f.write(header + ihdr + idat + iend)
    
    print(f"Created {filename} ({size}x{size})")

create_png(16, 'icon16.png')
create_png(48, 'icon48.png')
create_png(128, 'icon128.png')
PYTHON

echo "Icons generated!"
