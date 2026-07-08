import os
import io
import xml.etree.ElementTree as ET
from cairosvg import svg2png
from PIL import Image

# Configuration
INPUT_FOLDER = "icons/svg"
OUTPUT_FOLDER = "icons/png"
SIZE = 144  # Set to 144 (24 * 6) for integer scaling
PADDING = 12
COLORS = {
    "white": "#FFFFFF",
    "blurple": "#5865F2",
    "black": "#000000"
}
FLIP_ICONS = ["play", "fast-forward"]

if not os.path.exists(OUTPUT_FOLDER):
    os.makedirs(OUTPUT_FOLDER)

def apply_color(svg_root, color):
    # Removed the crispEdges shape-rendering as it breaks curved vectors
    
    for elem in svg_root.iter():
        # Apply color
        if 'fill' in elem.attrib and elem.attrib['fill'] != 'none':
            elem.set('fill', color)
        
        if 'stroke' in elem.attrib and elem.attrib['stroke'] != 'none':
            elem.set('stroke', color)
            # Restore Lucide's intended styling to fix broken arrows
            elem.set('stroke-linecap', 'round') 
            elem.set('stroke-linejoin', 'round') 
            
    return svg_root

def process_icons():
    for filename in os.listdir(INPUT_FOLDER):
        if not filename.endswith(".svg"):
            continue
            
        base_name = os.path.splitext(filename)[0]
        svg_path = os.path.join(INPUT_FOLDER, filename)
        
        # Load and parse SVG
        tree = ET.parse(svg_path)
        root = tree.getroot()
        
        # Get viewBox to calculate proper flipping
        view_box = root.get('viewBox', '0 0 24 24').split()
        width = view_box[2]
        
        # Define variants
        variants = [("normal", root)]
        if base_name in FLIP_ICONS:
            flipped_root = ET.fromstring(ET.tostring(root))
            # Flip and translate back into the viewBox
            flipped_root.set('transform', f'scale(-1, 1) translate(-{width}, 0)')
            variants.append(("flipped", flipped_root))

        for v_name, v_root in variants:
            for c_name, c_hex in COLORS.items():
                # Colorize
                apply_color(v_root, c_hex)
                
                # Render to PNG at final size directly
                png_data = svg2png(
                    bytestring=ET.tostring(v_root),
                    output_width=SIZE,
                    output_height=SIZE
                )
                
                # Save directly
                out_name = f"{base_name}_{v_name}_{c_name}.png" if v_name == "flipped" else f"{base_name}_{c_name}.png"
                final_path = os.path.join(OUTPUT_FOLDER, out_name)
                
                with open(final_path, 'wb') as f:
                    f.write(png_data)
                
                print(f"Generated: {out_name}")

if __name__ == "__main__":
    process_icons()