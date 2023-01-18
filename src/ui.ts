import './style.css';
import { initContext } from './context';
import { Demo } from './demos/demo';
import { DemoTriangle } from './demos/triangle';
import { DemoTriangleAntialias } from './demos/triangleAntialias';
import { DemoRenderBundle } from './demos/renderBundle';

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
    demo.resize();
    demo.init(refs, genOptions);
    currDemo = demo;
    currLink = link;
    link.classList.add('active');
  };
  link.href = `#?demo=${demo.name}`;

  refs.demos.push(link);
  refs.listDemo.append(link);
});

// init options
type Vec2 = [number, number];
type Vec3 = [number, number, number];
type Vec4 = [number, number, number, number];
type Options =
  | { value: string; onChange(v: string): void }
  | { value: string; onChange(v: string): void; color: true }
  | { value: string; onChange(v: string): void; options: string[] }
  | { value: number; onChange(v: number): void; step?: number; range?: [number, number] }
  | { value: Vec2; onChange(v: Vec2): void; step?: number; range?: [number, number] }
  | { value: Vec3; onChange(v: Vec3): void; step?: number; range?: [number, number] }
  | { value: Vec4; onChange(v: Vec4): void; step?: number; range?: [number, number] };
function genOptions(opts: Record<string, Options>) {
  Object.entries(opts).forEach(([optName, opt]) => {
    const can = document.createElement('div');
    const labal = document.createElement('div');
    const content = document.createElement('div');

    labal.innerText = optName;
    can.classList.add('opt-can');
    labal.classList.add('opt-labal');
    content.classList.add('opt-content');

    const isValueStr = typeof opt.value === 'string';
    const isValueNum = typeof opt.value === 'number';
    const isValueVec = Array.isArray(opt.value);
    const isValueColor = isValueStr && opt.color;
    const isValueSelect = isValueStr && opt.options;

    if (isValueColor) {
      const input = document.createElement('input');
      input.type = 'color';
      input.value = opt.value as string;
      input.onchange = () => opt.onChange(input.value);
      content.append(input);
    } else if (isValueSelect) {
      const select = document.createElement('select');
      (opt.options as string[]).forEach(i => {
        const option = document.createElement('option');
        option.value = i;
        option.innerText = i;
        select.append(option);
      });
      content.append(select);
    } else if (isValueStr) {
      const input = document.createElement('input');
      input.value = opt.value as string;
      input.onchange = () => opt.onChange(input.value);
      content.append(input);
    } else if (isValueNum) {
      const input = document.createElement('input');
      input.type = 'number';
      input.value = opt.value as string;
      input.onchange = () => opt.onChange(input.value);
      content.append(input);
    } else if (isValueVec) {
      const arr = opt.value as number[];
      const len = arr.length;
      const valueMutation = [...arr];
      for (let i = 0; i < len; i++) {
        const input = document.createElement('input');
        input.type = 'number';
        input.value = String(arr[i]);
        input.onchange = () => {
          valueMutation[i] = Number(input.value);
          opt.onChange(valueMutation);
        };
        content.append(input);
      }
    }

    can.append(labal, content);
    refs.listOption.append(can);
  });
}
type GenOptions = typeof genOptions;

// check WebGPU
initContext(refs)
  .then(() => {
    // resize
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
      refs.demos[demoIndex === -1 ? 0 : demoIndex].click();
    } catch (error) {
      console.error(error);
    }
  })
  .catch(error => {
    console.error(error);
    refs.errorUnsupport.style.display = 'flex';
  });

export { refs, genOptions };
export type { Refs, GenOptions };
