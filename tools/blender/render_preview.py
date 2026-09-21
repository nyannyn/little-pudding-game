"""在 Blender 內執行：把目前場景（或指定 collection）以 4 個角度渲染成 PNG，供視覺簽核。

用法（Blender MCP 的 execute_blender_code，或 blender --background file.blend --python 本檔）：
    exec(open(r"<repo>/tools/blender/render_preview.py").read())
    render_preview(r"<repo>/docs/previews/pudding_base", size=512)
輸出：<out>_000.png … <out>_270.png（正面、右側、背面、左側）
"""
import math
import bpy


def render_preview(out_prefix: str, size: int = 512, target=None, angles=(0, 90, 180, 270), elevation_deg=22.0):
    scene = bpy.context.scene
    # Eevee 快、夠用；預覽只看造型與顏色
    engine = "BLENDER_EEVEE_NEXT" if hasattr(bpy.types, "SceneEEVEE") and bpy.app.version >= (4, 2, 0) else "BLENDER_EEVEE"
    scene.render.engine = engine
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    # 預覽要看的是「材質底色對不對」，AgX 會把飽和色洗成米白；一律用 Standard
    try:
        scene.view_settings.view_transform = "Standard"
    except TypeError:
        pass

    # 取要拍的物件範圍
    objs = [o for o in (target or scene.objects) if o.type == "MESH" and not o.hide_render]
    if not objs:
        raise RuntimeError("沒有可渲染的 mesh")
    xs, ys, zs = [], [], []
    for o in objs:
        for v in o.bound_box:
            p = o.matrix_world @ __import__("mathutils").Vector(v)
            xs.append(p.x); ys.append(p.y); zs.append(p.z)
    cx, cy, cz = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2
    radius = max(max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)) / 2 or 1.0

    cam_data = bpy.data.cameras.new("PreviewCam")
    cam_data.lens = 50
    cam = bpy.data.objects.new("PreviewCam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam

    # 三點光：主光暖、補光冷、背光；預覽用，不影響匯出（GLB 不帶燈）
    lights = []
    for name, loc, energy, color in (
        ("PreviewKey", (4, -4, 6), 3400, (1.0, 0.93, 0.8)),
        ("PreviewFill", (-5, -3, 3), 1150, (0.85, 0.9, 1.0)),
        ("PreviewRim", (0, 5, 4), 1700, (1.0, 1.0, 1.0)),
    ):
        # 燈的位置隨 radius 線性縮放，能量必須隨 radius 平方縮放，否則小物件會過曝
        ld = bpy.data.lights.new(name, "POINT"); ld.energy = energy * radius * radius; ld.color = color
        lo = bpy.data.objects.new(name, ld); lo.location = (cx + loc[0] * radius, cy + loc[1] * radius, cz + loc[2] * radius)
        scene.collection.objects.link(lo); lights.append(lo)

    dist = radius * 3.2
    elev = math.radians(elevation_deg)
    try:
        for a in angles:
            t = math.radians(a)
            cam.location = (cx + dist * math.cos(elev) * math.sin(t), cy - dist * math.cos(elev) * math.cos(t), cz + dist * math.sin(elev))
            direction = __import__("mathutils").Vector((cx, cy, cz)) - cam.location
            cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
            scene.render.filepath = f"{out_prefix}_{a:03d}.png"
            bpy.ops.render.render(write_still=True)
    finally:
        for lo in lights:
            bpy.data.objects.remove(lo, do_unlink=True)
        bpy.data.objects.remove(cam, do_unlink=True)
        bpy.data.cameras.remove(cam_data)
    return [f"{out_prefix}_{a:03d}.png" for a in angles]
