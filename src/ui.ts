import './style.css';
import { initContext } from './context';
import { Demo } from './demos/demo';
import { DemoTriangle } from './demos/triangle';
import { DemoTriangleAntialias } from './demos/triangleAntialias';
import { DemoRenderBundle } from './demos/renderBundle';
import { DemoTriangleRotating } from './demos/triangleRotating';
import { DemoMeshline } from './demos/meshline';
import { DemoBitonicSorter } from './demos/bitonicSorter';
import { DemoClusterForward } from './demos/clusterForward';
import { DemoGravityParticles } from './demos/gravityParticles';
import { DemoStructBuffer } from './demos/structBuffer';
import { DemoCube } from './demos/cube';

const refs = {
  planeLeft: document.getElementsByClassName('plane left').item(0) as HTMLDivElement,
  planeRight: document.getElementsByClassName('plane right').item(0) as HTMLDivElement,
  planeMiddle: document.getElementsByClassName('plane middle').item(0) as HTMLDivElement,
  listDemo: document.getElementsByClassName('list demo').item(0) as HTMLDivElement,
  listOption: document.getElementsByClassName('list option').item(0) as HTMLDivElement,
  errorUnsupport: document.getElementsByClassName('error-unsupport').item(0) as HTMLDivElement,
  gfx: document.getElementById('gfx') as HTMLCanvasElement,
  demos: [] as HTMLAnchorElement[],
  options: [] as HTMLDivElement[],
};
type Refs = typeof refs;

let currDemo: Demo;
let currLink: HTMLElement;
const demos: Array<Demo> = [
  new DemoTriangle(),
  new DemoTriangleAntialias(),
  new DemoRenderBundle(),
  new DemoTriangleRotating(),
  new DemoMeshline(),
  new DemoBitonicSorter(),
  new DemoClusterForward(),
  new DemoGravityParticles(),
  new DemoStructBuffer(),
  new DemoCube(),
];

// init demo list
demos.forEach(demo => {
  const link = document.createElement('a');
  const preview = document.createElement('img');
  const name = document.createElement('div');
  link.classList.add('demo-item');
  preview.classList.add('demo-item-preview');
  name.classList.add('demo-item-name');
  link.append(preview);
  link.append(name);

  name.innerText = demo.name;
  preview.src = demo.preview;

  link.onclick = () => {
    currDemo?.dispose();
    currLink?.classList.remove('active');
    refs.listOption.innerHTML = '';
    demo.init(refs, genOptions);
    demo.resize();
    currDemo = demo;
    currLink = link;
    document.title = `${demo.name} WebGPU Demo`;
    link.classList.add('active');
  };
  link.href = `#?demo=${demo.name}`;

  refs.demos.push(link);
  refs.listDemo.append(link);
});

// init options
type Els = { can: HTMLElement; label: HTMLElement; content: HTMLElement };
// prettier-ignore
type Options =
  | { value: boolean; onChange(v: boolean, els: Els, opt: Options, optName: string): void}
  | { value: string; onChange(v: string, els: Els, opt: Options, optName: string): void }
  | { value: string; onChange(v: string, els: Els, opt: Options, optName: string): void; color: true }
  | { value: string; onChange(v: string, els: Els, opt: Options, optName: string): void; options: string[] }
  | { value: number; onChange(v: number, els: Els, opt: Options, optName: string): void; step?: number; range?: [number, number] }
  | { value: Vec2; onChange(v: Vec2, els: Els, opt: Options, optName: string): void; step?: number; range?: [number, number] }
  | { value: Vec3; onChange(v: Vec3, els: Els, opt: Options, optName: string): void; step?: number; range?: [number, number] }
  | { value: Vec4; onChange(v: Vec4, els: Els, opt: Options, optName: string): void; step?: number; range?: [number, number] };
function genOptions(opts: Record<string, Options>) {
  Object.entries(opts).forEach(([optName, opt]) => {
    const can = document.createElement('div');
    const label = document.createElement('div');
    const content = document.createElement('div');

    label.innerText = optName;
    can.classList.add('opt-can');
    label.classList.add('opt-label');
    content.classList.add('opt-content');

    const isValueBool = typeof opt.value === 'boolean';
    const isValueStr = typeof opt.value === 'string';
    const isValueNum = typeof opt.value === 'number';
    const isValueVec = Array.isArray(opt.value);
    const isValueColor = isValueStr && (opt as any).color;
    const isValueSelect = isValueStr && (opt as any).options;

    const els = { can, label, content };

    if (isValueColor) {
      const input = document.createElement('input');
      input.type = 'color';
      input.value = opt.value as string;
      input.onchange = () => {
        opt.value = input.value;
        opt.onChange(input.value, els, opt, optName);
      };
      content.append(input);
    } else if (isValueSelect) {
      const select = document.createElement('select');
      ((opt as any).options as string[]).forEach(i => {
        const option = document.createElement('option');
        option.value = i;
        option.innerText = i;
        select.append(option);
      });
      select.onchange = () => {
        opt.value = select.value;
        opt.onChange(select.value, els, opt, optName);
      };
      select.value = opt.value;
      content.append(select);
    } else if (isValueStr) {
      const input = document.createElement('input');
      input.value = opt.value as string;
      input.onchange = () => {
        opt.value = input.value;
        opt.onChange(input.value, els, opt, optName);
      };
      label.append(input);
    } else if (isValueNum) {
      const input = document.createElement('input');
      input.type = 'number';
      input.value = opt.value as unknown as string;
      input.step = opt.step as unknown as string;
      input.onchange = () => {
        const v = Number(input.value);
        if (opt.range) {
          const [min, max] = opt.range;
          if (v < min || v > max) {
            input.value = String(Math.min(Math.max(v, min), max));
            return;
          }
        }
        opt.value = v;
        opt.onChange(v, els, opt, optName);
      };
      content.append(input);
    } else if (isValueVec) {
      const arr = opt.value as number[];
      const len = arr.length;
      const valueMutation: Vec2 | Vec3 | Vec4 = [...arr] as any;
      for (let i = 0; i < len; i++) {
        const input = document.createElement('input');
        input.classList.add('opt-vec-input');
        input.type = 'number';
        input.value = String(arr[i]);
        input.step = (opt as any).step as unknown as string;
        input.onchange = () => {
          const v = Number(input.value);
          if (opt.range) {
            const [min, max] = opt.range;
            if (v < min || v > max) {
              input.value = String(Math.min(Math.max(v, min), max));
              return;
            }
          }
          valueMutation[i] = v;
          opt.value = valueMutation;
          opt.onChange(valueMutation as any, els, opt, optName);
        };
        content.append(input);
      }
    } else if (isValueBool) {
      const input = document.createElement('input');
      input.checked = opt.value;
      input.type = 'checkbox';
      input.onchange = () => {
        opt.value = input.checked;
        opt.onChange(input.checked, els, opt, optName);
      };
      label.append(input);
    }

    can.append(label, content);
    refs.listOption.append(can);
    return opts;
  });
}
type GenOptions = typeof genOptions;

// check WebGPU
initContext(refs)
  .then(() => {
    // resize
    // const devicePixelRatio = 1;
    refs.gfx.width = refs.gfx.clientWidth * devicePixelRatio;
    refs.gfx.height = refs.gfx.clientHeight * devicePixelRatio;
    const resizeObsrever = new ResizeObserver(entries => {
      const box = entries[0];
      if (box) {
        refs.gfx.width = box.contentRect.width * devicePixelRatio;
        refs.gfx.height = box.contentRect.height * devicePixelRatio;
        currDemo?.resize();
      }
    });
    resizeObsrever.observe(refs.gfx);

    try {
      const urlParams = new URLSearchParams(location.hash ? location.hash.slice(1) : '');
      const demoName = urlParams.get('demo');
      const demoIndex = demos.findIndex(i => i.name == demoName);
      const demo = refs.demos[demoIndex === -1 ? 0 : demoIndex];
      demo.click();
      demo.scrollIntoView();
      if (demoName) document.title = `${demoName} WebGPU Demo`;
    } catch (error) {
      console.error(error);
    }
  })
  .catch(error => {
    console.error(error);
    refs.errorUnsupport.style.display = 'flex';
  });

export { refs, genOptions };
export type { Refs, GenOptions, Els, Options };
