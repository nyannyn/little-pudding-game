"""在 Blender 內執行：以 bpy 程序化生成基礎布丁（焦糖布丁，CP1 的 pudding_base）。

用法（Blender MCP 的 execute_blender_code，或 blender --background --python 本檔）：
    exec(open(r"<repo>/tools/blender/build_pudding.py", encoding="utf-8").read())
    build_pudding()

產出一個空物件根節點＋兩個 mesh（原點一律在底面中心）：
    Pudding_Root    Empty，兩個 mesh 的共同父節點；縮放它＝squash & stretch
    Pudding_Body    本體＋焦糖糖衣＋腮紅**併成一個 mesh、一個材質**（D41：InstancedMesh 一個 draw call 畫全部）。
                    哪個頂點屬於哪一部分寫在頂點色層 `Mask`：R＝本體、G＝焦糖、B＝腮紅，
                    真正的顏色由遊戲端每隻布丁的 instance 屬性（物種體色／頂色）在 shader 裡混出來。
                    Blender 端的材質也照同一條公式從 Mask 混色，預覽圖才會跟遊戲一樣。
    Pudding_Eyes    左右眼併成一個 mesh；沒併進本體是因為閉眼要單獨壓扁它（instance 矩陣各自算）

根節點刻意做成不帶 mesh 的 Empty：gltf-transform 的 quantize() 碰到「自己有 mesh 又有子節點」
的節點時，會把 mesh 搬到一個新的無名子節點上，那樣 Pudding_Body 這個名字就會指到群組而不是本體。

面數約 1228（預算 3000）。draw call：全部布丁合計 2 個（本體＋眼睛）＋ 1 個陰影 pass。
原點在底面中心＝直接縮放 Pudding_Root 就是 squash & stretch（子物件跟著變形）。

無頭一條龍（不必開 Blender 介面、不必接 MCP）：
    blender --background --python tools/blender/build_pudding.py -- \
        --out public/models/pudding_base.glb --preview docs/previews/pudding_base
之後跑 `npm run models:optimize`。
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

# 本體輪廓（x=半徑, z=高），底面中心在原點；1 世界單位 ≈ 10 cm
BODY = [
    (0.000, 0.000), (0.395, 0.000), (0.470, 0.016), (0.500, 0.052),
    (0.468, 0.265), (0.430, 0.455), (0.388, 0.595), (0.348, 0.663),
    (0.296, 0.702), (0.196, 0.724), (0.000, 0.732),
]
STEPS = 26      # 旋轉體經線數；再低剖面輪廓會看得出多邊形
GLAZE = 0.016   # 糖衣厚度
RIM_Z = 0.615   # 焦糖底緣基準高度


def _mat(name, rgb, rough=0.45):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    # 節點一律用 type 找：非英文介面的 Blender 上 nodes["Principled BSDF"] 會是 None
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs[0].default_value = (rgb[0], rgb[1], rgb[2], 1.0)
    if "Roughness" in bsdf.inputs:
        bsdf.inputs["Roughness"].default_value = rough
    return m


# 遊戲端 SPECIES.caramel 的體色／頂色與腮紅色；只是 Blender 預覽用，遊戲裡每隻各自帶顏色
SKIN_BODY = (1.000, 0.760, 0.290)
SKIN_TOPPING = (0.455, 0.185, 0.058)
SKIN_BLUSH = (1.000, 0.470, 0.520)
MASK_LAYER = "Mask"


def _skin_mat(name, rough=0.45):
    """本體／焦糖／腮紅共用的單一材質：Base Color ＝ body·Mask.r ＋ topping·Mask.g ＋ blush·Mask.b。

    跟遊戲端 shader 同一條公式。三個部件必須共用一個材質，glTF 才會匯成一個 primitive；
    材質一多，匯出器就照材質拆 primitive，InstancedMesh 又變回好幾個 draw call。
    """
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nodes, links = m.node_tree.nodes, m.node_tree.links
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    if "Roughness" in bsdf.inputs:
        bsdf.inputs["Roughness"].default_value = rough
    mask = nodes.new("ShaderNodeVertexColor")
    mask.layer_name = MASK_LAYER
    sep = nodes.new("ShaderNodeSeparateColor")
    links.new(mask.outputs["Color"], sep.inputs["Color"])
    scaled = []
    for ch, rgb in (("Red", SKIN_BODY), ("Green", SKIN_TOPPING), ("Blue", SKIN_BLUSH)):
        n = nodes.new("ShaderNodeVectorMath")
        n.operation = "SCALE"
        n.inputs[0].default_value = rgb
        links.new(sep.outputs[ch], n.inputs["Scale"])
        scaled.append(n)
    add1 = nodes.new("ShaderNodeVectorMath"); add1.operation = "ADD"
    add2 = nodes.new("ShaderNodeVectorMath"); add2.operation = "ADD"
    links.new(scaled[0].outputs["Vector"], add1.inputs[0])
    links.new(scaled[1].outputs["Vector"], add1.inputs[1])
    links.new(add1.outputs["Vector"], add2.inputs[0])
    links.new(scaled[2].outputs["Vector"], add2.inputs[1])
    links.new(add2.outputs["Vector"], bsdf.inputs["Base Color"])
    return m


def _mask(obj, rgb):
    """整個 mesh 的頂點色層 `Mask` 塗成同一個值（哪個部件＝哪個 channel 亮）。"""
    me = obj.data
    layer = me.color_attributes.get(MASK_LAYER) or me.color_attributes.new(MASK_LAYER, "FLOAT_COLOR", "POINT")
    for c in layer.data:
        c.color = (rgb[0], rgb[1], rgb[2], 1.0)
    me.color_attributes.active_color = layer
    me.color_attributes.render_color_index = me.color_attributes.find(MASK_LAYER)


def _lathe(name, profile, material, steps=STEPS):
    bm = bmesh.new()
    vs = [bm.verts.new((x, 0.0, z)) for (x, z) in profile]
    es = [bm.edges.new((vs[i], vs[i + 1])) for i in range(len(vs) - 1)]
    bmesh.ops.spin(bm, geom=vs + es, axis=(0, 0, 1), cent=(0, 0, 0),
                   dvec=(0, 0, 0), angle=2 * math.pi, steps=steps, use_merge=False)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
    bad = [f for f in bm.faces if f.calc_area() < 1e-9]   # 極點併起來後的零面積面
    if bad:
        bmesh.ops.delete(bm, geom=bad, context="FACES_ONLY")
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(material)
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def _radius_at(z):
    for i in range(len(BODY) - 1):
        (x0, z0), (x1, z1) = BODY[i], BODY[i + 1]
        if z0 <= z <= z1 and z1 > z0:
            return x0 + (x1 - x0) * (z - z0) / (z1 - z0)
    return BODY[-2][0] if z > BODY[-1][1] else BODY[1][0]


def _offset_profile(pts, d):
    """沿輪廓外法線等距外推。純半徑方向外推在頂部圓頂推不夠，本體會從糖衣裡冒出來。"""
    out, n = [], len(pts)
    for i, (x, z) in enumerate(pts):
        px, pz = pts[max(i - 1, 0)]
        qx, qz = pts[min(i + 1, n - 1)]
        tx, tz = qx - px, qz - pz
        L = math.hypot(tx, tz) or 1.0
        out.append((max(x + (tz / L) * d, 0.0), z + (-tx / L) * d))
    return out


def _face_part(name, material, z, theta_deg, scale, radius, out=0.0, seg=10, ring=5):
    """壓扁的小球貼在本體表面。

    out 必須大於壓扁後的半厚度，否則整顆埋進本體看不見。
    壓扁方向是 local Y，所以正面輪廓只由**緯度環數 ring** 決定；ring 太少會看到多邊形邊，
    加 seg（經線）沒有用。
    """
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=ring, radius=radius,
                                         location=(0, 0, 0))
    obj = bpy.context.active_object
    obj.name = obj.data.name = name
    obj.data.materials.clear()
    obj.data.materials.append(material)
    obj.matrix_world = (Matrix.Rotation(math.radians(theta_deg), 4, "Z")
                        @ Matrix.Translation((0.0, -(_radius_at(z) + out), z))
                        @ Matrix.Diagonal(Vector((scale[0], scale[1], scale[2], 1.0))))
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return obj


def _join(target, others, new_name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in others:
        o.select_set(True)
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.join()
    target.name = target.data.name = new_name
    return target


def _smooth_by_angle(obj, angle):
    """面全設平滑、兩面夾角超過 angle 的邊標 sharp（＝4.1+ 的 Smooth by Angle，但不靠 operator）。

    `bpy.ops.object.shade_auto_smooth` 在 `--background` 下回 CANCELLED：它要從內建資產庫載
    「Smooth by Angle」節點群組，背景模式載不到（log 會印 Asset loading is unfinished）。
    """
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    sharp = [e.index for e in bm.edges if not e.is_manifold or e.calc_face_angle(0.0) > angle]
    bm.free()
    me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    if sharp:
        layer = me.attributes.get("sharp_edge") or me.attributes.new("sharp_edge", "BOOLEAN", "EDGE")
        for i in sharp:
            layer.data[i].value = True
    me.update()


def _tris(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def build_pudding():
    # 冪等：每次重跑先清掉預設 Cube 與上一輪產物，否則重複堆疊會汙染面數與預覽構圖
    for o in list(bpy.data.objects):
        if o.name == "Cube" or o.name.startswith("Pudding_"):   # 含 Pudding_Root
            bpy.data.objects.remove(o, do_unlink=True)
    for me in list(bpy.data.meshes):
        if me.users == 0:
            bpy.data.meshes.remove(me)

    m_skin = _skin_mat("Pudding_Skin", 0.45)
    m_eye = _mat("Pudding_EyeMat", (0.090, 0.065, 0.060), 0.35)

    body = _lathe("Pudding_Body", BODY, m_skin)

    src = [(_radius_at(RIM_Z - 0.07), RIM_Z - 0.07),
           (_radius_at(RIM_Z), RIM_Z),
           (_radius_at(0.641), 0.641)]
    src += [(x, z) for (x, z) in BODY if z > 0.641]
    shell = _offset_profile(src, GLAZE)[1:]
    shell[-1] = (0.0, shell[-1][1])          # 頂端回正中軸，避免極點裂開
    rim_oz, mid_oz = shell[0][1], shell[1][1]
    caramel = _lathe("Pudding_Caramel", [(0.000, 0.420), (0.300, 0.420)] + shell, m_skin)

    # 4 瓣淋流，相位對正正面（θ=-π/2 落在波谷）→ 臉不會被焦糖蓋到。
    # 瓣數不可太多：26 條經線下 5 瓣就取樣不足，邊緣會變鋸齒。
    def drip(theta):
        return 0.018 + 0.042 * (0.5 - 0.5 * math.cos(4 * (theta + math.pi / 2)))

    for v in caramel.data.vertices:
        for ring_z, k in ((rim_oz, 1.0), (mid_oz, 0.32)):
            if abs(v.co.z - ring_z) < 1e-4:
                theta = math.atan2(v.co.y, v.co.x)
                nz = ring_z - drip(theta) * k
                nr = _radius_at(nz) + GLAZE     # 順著本體表面往下淌，否則淌進本體裡面
                v.co = Vector((nr * math.cos(theta), nr * math.sin(theta), nz))
                break

    eyes = _join(
        _face_part("Pudding_Eye_L", m_eye, 0.436, 13.5, (0.95, 0.46, 1.32), 0.042, out=-0.006, seg=8, ring=8),
        [_face_part("Pudding_Eye_R", m_eye, 0.436, -13.5, (0.95, 0.46, 1.32), 0.042, out=-0.006, seg=8, ring=8)],
        "Pudding_Eyes")
    blush = _join(
        _face_part("Pudding_Blush_L", m_skin, 0.332, 38.0, (1.35, 0.20, 0.85), 0.062, out=0.004, seg=8, ring=8),
        [_face_part("Pudding_Blush_R", m_skin, 0.332, -38.0, (1.35, 0.20, 0.85), 0.062, out=0.004, seg=8, ring=8)],
        "Pudding_Blush")

    # 併之前先各自塗遮罩：join 之後就分不出哪個頂點原本是誰的了
    report = {"body": _tris(body), "caramel": _tris(caramel), "blush": _tris(blush), "eyes": _tris(eyes)}
    _mask(body, (1, 0, 0))
    _mask(caramel, (0, 1, 0))
    _mask(blush, (0, 0, 1))
    body = _join(body, [caramel, blush], "Pudding_Body")
    # 球體 primitive 帶進來的 UV 沒有貼圖在用，匯出只是白占位元組
    for o in (body, eyes):
        while o.data.uv_layers:
            o.data.uv_layers.remove(o.data.uv_layers[0])
    # join 會把三個物件的材質槽都收進來（同一顆材質也會留三格），清成一格才是一個 primitive
    while len(body.data.materials) > 1:
        body.data.materials.pop(index=len(body.data.materials) - 1)

    root = bpy.data.objects.new("Pudding_Root", None)
    root.empty_display_size = 0.2
    bpy.context.scene.collection.objects.link(root)
    for child in (body, eyes):
        child.parent = root
        child.matrix_parent_inverse = root.matrix_world.inverted()

    for o in (body, eyes):
        _smooth_by_angle(o, math.radians(40))

    report["Pudding_Body"] = _tris(body)
    report["Pudding_Eyes"] = _tris(eyes)
    report["TOTAL"] = report["Pudding_Body"] + report["Pudding_Eyes"]
    report["bbox"] = [round(v, 3) for v in body.dimensions]
    report["materials"] = [m.name for m in body.data.materials]
    return report


def export_pudding(path):
    """把 Pudding_Root 整棵匯成 GLB（Y-up）。頂點色只匯 `Mask` 這一層。"""
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    root = bpy.data.objects["Pudding_Root"]
    for o in (root, *root.children_recursive):
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=os.path.abspath(path), export_format="GLB", use_selection=True,
        export_apply=True, export_yup=True,
        export_vertex_color="NAME", export_vertex_color_name=MASK_LAYER, export_all_vertex_colors=False,
    )
    return os.path.getsize(path)


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    # 一律轉絕對路徑：Blender 的 render.filepath 不是對 cwd 解相對路徑（實測寫到 C:\docs\ 去）
    out = os.path.abspath(argv[argv.index("--out") + 1]) if "--out" in argv else None
    preview = os.path.abspath(argv[argv.index("--preview") + 1]) if "--preview" in argv else None
    print("BUILD", build_pudding())
    if preview:
        here = os.path.dirname(os.path.abspath(__file__))
        ns = {}
        exec(open(os.path.join(here, "render_preview.py"), encoding="utf-8").read(), ns)
        print("PREVIEW", ns["render_preview"](preview, size=512))
    if out:
        print("EXPORT", out, export_pudding(out), "bytes")
