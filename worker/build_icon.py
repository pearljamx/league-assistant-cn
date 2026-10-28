"""Draw the repository's own shield/swords icon; no downloaded brand artwork."""
from pathlib import Path
from PIL import Image, ImageDraw

S = 4
image = Image.new('RGBA', (256*S, 256*S))
draw = ImageDraw.Draw(image)
scale = lambda points: [(x*S, y*S) for x, y in points]
draw.rounded_rectangle((8*S,8*S,248*S,248*S), radius=52*S, fill='#142024')
hexagon = [(128,30),(212,78),(212,174),(128,224),(44,174),(44,78),(128,30)]
draw.polygon(scale(hexagon), fill='#1c2d30')
draw.line(scale(hexagon), fill='#cfb47b', width=5*S, joint='curve')
for points in [[(82,67),(163,166)],[(150,164),(166,149)],[(174,67),(93,166)],[(106,164),(90,149)],[(77,67),(81,89)],[(174,67),(170,89)]]:
    draw.line(scale(points), fill='#dfc898', width=9*S)
draw.polygon(scale([(128,191),(135,201),(128,211),(121,201)]),fill='#cfb47b')
image=image.resize((256,256),Image.Resampling.LANCZOS)
root=Path(__file__).resolve().parents[1]/'resources'
root.mkdir(exist_ok=True)
image.save(root/'icon.png')
image.save(root/'icon.ico',sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
