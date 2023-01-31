// @override var<private> invoc_num: u32;
// @override var<private> invoc_h: u32;
override invoc_num: u32;
override invoc_h: u32;

// 0 local_bms 
// 2 local_disp 
// 1 storage_flip_once 
// 3 storage_disp_once
struct UBO {
  kernal: u32,
  work_h: u32,
};
@group(0) @binding(1) var<uniform> ubo: UBO;
@group(0) @binding(0) var<storage, read_write> list: array<f32>;

var<private> wg_id: u32;
var<private> invoc_id: u32;
var<private> global_invoc_id: u32;
var<workgroup> worklist: array<f32, invoc_h>;

fn local_compare_swap(v: vec2<u32>) {
    if worklist[v.x] > worklist[v.y] {
        let tmp = worklist[v.x];
        worklist[v.x] = worklist[v.y];
        worklist[v.y] = tmp;
    }
    workgroupBarrier();
}

fn flip_once(h: u32, id: u32) -> vec2<u32> {
    let half_h = h >> 1u;
    let id_div = id / half_h;
    let id_mod = id % half_h;
    let l = id_div * h + id_mod;
    let r = (id_div + 1u) * h - (id_mod + 1u);
    return vec2<u32>(l, r);
}

fn disp_once(h: u32, id: u32) -> vec2<u32> {
    let half_h = h >> 1u;
    let id_div = id / half_h;
    let id_mod = id % half_h;
    let l = id_div * h + id_mod;
    let r = l + half_h; // l + h / 2
    return vec2<u32>(l, r);
}

fn local_bms(max_h: u32) {
    var up_h = 2u;
    var down_h = 2u;
    // up loop
    loop {
        if up_h > max_h { break; }

        local_compare_swap(flip_once(up_h, invoc_id));

        local_disp(up_h);

        up_h = up_h << 1u;
    }
}

fn local_disp(h: u32) {
    var down_h = h;

    loop {
        if down_h < 2u { break; }

        local_compare_swap(disp_once(down_h, invoc_id));

        down_h = down_h >> 1u;
    };
}

fn storage_compare_swap(v: vec2<u32>) {
    if list[v.x] > list[v.y] {
        let tmp = list[v.x];
        list[v.x] = list[v.y];
        list[v.y] = tmp;
    }
}

@compute @workgroup_size(invoc_num)
fn main(@builtin(workgroup_id) wg_id_: vec3<u32>, @builtin(local_invocation_index) invoc_id_: u32, @builtin(global_invocation_id) global_invoc_id_: vec3<u32>) {
    wg_id = wg_id_.x;
    invoc_id = invoc_id_;
    global_invoc_id = global_invoc_id_.x;

    // 按照flip h: 2 的step的数据写入worklist, 顺序无关
    let l = invoc_id << 1u;
    let r = l + 1u;
    let list_offset: u32 = wg_id * invoc_h;
    if (ubo.kernal & 1u) == 0u { // kernal == (0 || 2) local_bms/local_disp
        worklist[l] = list[list_offset + l];
        worklist[r] = list[list_offset + r];
        workgroupBarrier();
    }

    switch ubo.kernal {
      case 0u: { local_bms(ubo.work_h); }
      case 1u: { storage_compare_swap(flip_once(ubo.work_h, global_invoc_id)); }
      case 2u: { local_disp(ubo.work_h); }
      case 3u: { storage_compare_swap(disp_once(ubo.work_h, global_invoc_id)); }
      default: {}
    }

    // 写回storage
    if (ubo.kernal & 1u) == 0u {
        workgroupBarrier();
        list[list_offset + l] = worklist[l];
        list[list_offset + r] = worklist[r];
    }
}