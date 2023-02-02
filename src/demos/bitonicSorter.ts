import arrayShuffle from 'array-shuffle';
import { debounce } from 'lodash-es';
import { adapter, canvasCtx, device, queue } from '../context';
import { GenOptions, Refs, Els, Options } from '../ui';
import { Demo } from './demo';
import BMSComputeShader from '../shaders/bms.compute.wgsl?raw';
import BMSVertShader from '../shaders/bms.vert.wgsl?raw';
import BMSFragShader from '../shaders/bms.frag.wgsl?raw';

enum Kernel {
  local_bms = 0,
  local_disp = 2,
  storage_flip_once = 1,
  storage_disp_once = 3,
}
/**
 * tutorial https://poniesandlight.co.uk/reflect/bitonic_merge_sort/
 */
export class DemoBitonicSorter implements Demo {
  name = 'BitonicSorter';
  preview = '';
  bindGroup!: GPUBindGroup;
  pipeline!: GPUComputePipeline;
  buffers!: { listBuffer: GPUBuffer; listStagingBuffer: GPUBuffer; uniformBuffer: GPUBuffer };
  listLen!: number;
  debug = false;
  renderDispatch = true;
  renderCleared = false;
  lastCompute!: Promise<void>;
  bindGroupLayout!: GPUBindGroupLayout;
  uniformBuffer!: GPUBuffer;
  invocNum = 4;
  opts!: { invocation: number; dataSize: number };
  listData!: number[];
  csm!: GPUShaderModule;
  infoNode!: HTMLPreElement;
  renderBindGroupLayout!: GPUBindGroupLayout;
  renderPipeline!: GPURenderPipeline;
  renderBindGroup!: GPUBindGroup;
  positionUVBuffer!: GPUBuffer;
  dispatchLen!: number;
  renderUniformBuffer!: GPUBuffer;
  inited = false;

  async init(refs: Refs, genOptions: GenOptions): Promise<void> {
    // layout
    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });
    const renderBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      ],
    });

    const renderPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [renderBindGroupLayout] }),
      vertex: {
        module: device.createShaderModule({ code: BMSVertShader }),
        entryPoint: 'main',
        buffers: [
          {
            arrayStride: 4 * 4,
            stepMode: 'vertex',
            attributes: [
              { offset: 0, format: 'float32x2', shaderLocation: 0 },
              { offset: 4 * 2, format: 'float32x2', shaderLocation: 1 },
            ],
          },
        ],
      },
      fragment: {
        module: device.createShaderModule({ code: BMSFragShader }),
        entryPoint: 'main',
        targets: [{ format: 'bgra8unorm' }],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none',
        frontFace: 'cw',
      },
    });

    // ubo
    const uniformBufferData = new Uint32Array(2);
    const uniformBuffer = device.createBuffer({
      size: (uniformBufferData.byteLength + 3) & ~3,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Uint32Array(uniformBuffer.getMappedRange()).set(uniformBufferData);
    uniformBuffer.unmap();

    const renderUniformBufferData = new Uint32Array(3);
    const renderUniformBuffer = device.createBuffer({
      size: (renderUniformBufferData.byteLength + 3) & ~3,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Uint32Array(renderUniformBuffer.getMappedRange()).set(renderUniformBufferData);
    renderUniformBuffer.unmap();

    this.csm = device.createShaderModule({ code: BMSComputeShader });

    // prettier-ignore
    const positionUVBufferData = new Float32Array([
      // position uv
      -1,  1,     0, 1, // top-left
       1, -1,     1, 0, // bottom-right
      -1, -1,     0, 0, // bottom-left
      -1,  1,     0, 1, // top-left
       1,  1,     1, 1, // top-right
       1, -1,     1, 0, // bottom-right
    ]);
    const positionUVBuffer = device.createBuffer({
      size: (positionUVBufferData.byteLength + 3) & ~3,
      usage: GPUBufferUsage.VERTEX,
      mappedAtCreation: true,
    });
    new Float32Array(positionUVBuffer.getMappedRange()).set(positionUVBufferData);
    positionUVBuffer.unmap();

    this.bindGroupLayout = bindGroupLayout;
    this.uniformBuffer = uniformBuffer;

    this.renderBindGroupLayout = renderBindGroupLayout;
    this.renderPipeline = renderPipeline;
    this.positionUVBuffer = positionUVBuffer;
    this.renderUniformBuffer = renderUniformBuffer;

    const canvasConfig: GPUCanvasConfiguration = {
      device,
      format: 'bgra8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      alphaMode: 'opaque',
    };
    canvasCtx.configure(canvasConfig);

    this.opts = { invocation: 2, dataSize: 4 };

    this.initUI(refs, genOptions);
    this.inited = true;
  }

  initUI(refs: Refs, genOptions: GenOptions) {
    genOptions({
      invocation: {
        value: this.opts.invocation,
        range: [1, Math.log2(adapter.limits.maxComputeInvocationsPerWorkgroup)],
        onChange: async (v: number, els: Els, opt: Options, optName: string) => {
          this.opts.invocation = v;
          els.label.innerText = `${optName}(${Math.pow(2, v)})`;
          await this.prepare();
          this.lastCompute = this.compute();
        },
      },
      dataSize: {
        value: this.opts.dataSize,
        range: [1, 25], // 26 storage size就超过单个storage size限制, 需要拆分多个
        onChange: async (v: number, els: Els, opt: Options, optName: string) => {
          this.opts.dataSize = v;
          els.label.innerText = `${optName}(${Math.pow(2, v)})`;
          await this.prepare();
          this.lastCompute = this.compute();
        },
      },
      renderDispatch: {
        value: this.renderDispatch,
        onChange: async (v: boolean) => {
          this.renderDispatch = v;
          await this.lastCompute;
          this.lastCompute = this.compute();
        },
      },
    });
    const info = document.createElement('pre');
    info.style.fontSize = '14px';
    refs.listOption.append(info);
    this.infoNode = info;
  }

  async prepare() {
    await this.lastCompute;
    this.buffers?.listBuffer.destroy();
    this.buffers?.listStagingBuffer.destroy();

    const invocNum = Math.pow(2, this.opts.invocation);
    const dataSize = Math.pow(2, this.opts.dataSize);

    if (dataSize <= 32) drawBMSDiagram(dataSize, invocNum);
    else if (this.debug) console.log('BMS will not draw when data size exceed 32');

    const dispatchLen = calcDispatch(dataSize, invocNum);

    const pipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] }),
      compute: {
        module: this.csm,
        entryPoint: 'main',
        constants: { invoc_num: invocNum, invoc_h: invocNum * 2 },
      },
    });

    const listData = new Array(dataSize).fill(0).map((v, k) => k);
    this.listData = arrayShuffle(listData);
    const listBufferData = new Float32Array(this.listData);
    const listBuffer = device.createBuffer({
      size: (listBufferData.byteLength + 3) & ~3,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      mappedAtCreation: true,
    });
    new Float32Array(listBuffer.getMappedRange()).set(listBufferData);
    listBuffer.unmap();

    const listStagingBuffer = device.createBuffer({
      size: (listBufferData.byteLength + 3) & ~3,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    const bindGroup = device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: listBuffer } },
        { binding: 1, resource: { buffer: this.uniformBuffer } },
      ],
    });
    const renderBindGroup = device.createBindGroup({
      layout: this.renderBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.renderUniformBuffer } },
        { binding: 1, resource: { buffer: listBuffer } },
      ],
    });

    this.buffers = { listBuffer, listStagingBuffer, uniformBuffer: this.uniformBuffer };
    this.listLen = dataSize;
    this.bindGroup = bindGroup;
    this.renderBindGroup = renderBindGroup;
    this.pipeline = pipeline;
    this.invocNum = invocNum;
    this.dispatchLen = dispatchLen;
  }

  async dispatch(
    workgourpGrid: [number, number, number],
    kernel: Kernel,
    workH: number,
    dispatchId: number,
  ) {
    this.debug && console.log(`BMS dispatch kernel: ${kernel} workH: ${workH}`);
    const ubo = new Uint32Array([kernel, workH]);
    queue.writeBuffer(this.buffers.uniformBuffer, 0, ubo.buffer, ubo.byteOffset, ubo.byteLength);
    const commandEncoder = device.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass({});
    passEncoder.setPipeline(this.pipeline);
    passEncoder.setBindGroup(0, this.bindGroup);
    passEncoder.dispatchWorkgroups(workgourpGrid[0], workgourpGrid[1], workgourpGrid[2]);
    passEncoder.end();
    this.debug &&
      commandEncoder.copyBufferToBuffer(
        this.buffers.listBuffer,
        0,
        this.buffers.listStagingBuffer,
        0,
        this.buffers.listBuffer.size,
      );

    queue.submit([commandEncoder.finish()]);

    this.debug && (await this.readList(true));
    this.renderOneDispatch(dispatchId);
  }

  renderOneDispatch(dispatchId: number) {
    if (!this.renderDispatch) return;

    const width = 1 / this.dispatchLen;
    const offsetX = dispatchId * 2.0 * width;
    const ubo = new Float32Array([width, offsetX, this.listLen]);
    queue.writeBuffer(this.renderUniformBuffer, 0, ubo.buffer, ubo.byteOffset, ubo.byteLength);

    const colorTexture = canvasCtx.getCurrentTexture();
    const colorView = colorTexture.createView();
    const commandEncoder = device.createCommandEncoder();
    const passEncoder = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: colorView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: !this.renderCleared ? 'clear' : 'load',
          storeOp: 'store',
        },
      ],
    });
    const w = canvasCtx.canvas.width;
    const h = canvasCtx.canvas.height;
    passEncoder.setPipeline(this.renderPipeline);
    passEncoder.setBindGroup(0, this.renderBindGroup);
    passEncoder.setVertexBuffer(0, this.positionUVBuffer);
    passEncoder.setViewport(0, 0, w, h, 0, 1);
    passEncoder.setScissorRect(0, 0, w, h);
    passEncoder.draw(6);
    passEncoder.end();
    queue.submit([commandEncoder.finish()]);

    this.renderCleared = true;
  }

  async compute() {
    const startT = performance.now();
    const workgroupLimit = adapter.limits.maxComputeWorkgroupsPerDimension;
    const workgroupNum = (this.listLen * 0.5) / this.invocNum;
    const workgourpGrid: [number, number, number] = [1, 1, 1];
    if (workgroupNum <= workgroupLimit) {
      workgourpGrid[0] = Math.ceil(workgroupNum);
    } else if (workgroupNum <= Math.pow(workgroupLimit, 2)) {
      workgourpGrid[0] = Math.ceil(Math.sqrt(workgroupNum));
      workgourpGrid[1] = workgourpGrid[0];
    } else if (workgroupNum <= Math.pow(workgroupLimit, 3)) {
      workgourpGrid[0] = Math.ceil(Math.cbrt(workgroupNum));
      workgourpGrid[1] = workgourpGrid[0];
      workgourpGrid[2] = workgourpGrid[0];
    } else {
      // 长度超出可以计算的范围
    }

    console.log('workgourpGrid', workgourpGrid);

    // draw inter step data
    if (this.renderDispatch) {
      this.renderCleared = false;
    }

    // calc dispatch
    let lastStepLen = 0;
    let ex = 0;
    let dispatchId = 0;
    const maxParallelLen = this.invocNum * 2;
    for (let len = 2; len <= this.listLen; len *= 2, ex++) {
      const currStepLen = lastStepLen + 1 + ex;
      lastStepLen = currStepLen;
      if (len < maxParallelLen) continue;
      else if (len === maxParallelLen) {
        await this.dispatch(workgourpGrid, Kernel.local_bms, len, dispatchId);
        dispatchId++;
      } else {
        await this.dispatch(workgourpGrid, Kernel.storage_flip_once, len, dispatchId);
        dispatchId++;

        let downH = len * 0.5;
        for (; downH > maxParallelLen; downH *= 0.5) {
          await this.dispatch(workgourpGrid, Kernel.storage_disp_once, downH, dispatchId);
          dispatchId++;
        }
        await this.dispatch(workgourpGrid, Kernel.local_disp, downH, dispatchId);
        dispatchId++;
      }
    }

    const commandEncoder = device.createCommandEncoder();
    commandEncoder.copyBufferToBuffer(
      this.buffers.listBuffer,
      0,
      this.buffers.listStagingBuffer,
      0,
      this.buffers.listBuffer.size,
    );
    queue.submit([commandEncoder.finish()]);

    const submitT = performance.now();
    console.log(
      'BMS Submit',
      performance
        .measure('BMS Submit', {
          start: startT,
          end: submitT,
        })
        .duration.toFixed(2) + 'ms',
    );

    const sorted = await this.readList();
    const endT = performance.now();
    console.log('output', sorted);
    const BMSCost =
      `BMS GPU ${this.renderDispatch ? '+ Render ' : ''}` +
      performance.measure('BMS Compute', { start: startT, end: endT }).duration.toFixed(2) +
      'ms';
    console.log(BMSCost);

    let JSSortCost = '';
    if (this.listLen <= Math.pow(2, 23)) {
      this.listData.sort((a, b) => a - b);
      JSSortCost =
        'JS Sort ' +
        performance
          .measure('JS Sort', { start: endT, end: performance.now() })
          .duration.toFixed(2) +
        'ms';
      console.log(JSSortCost);
    }
    this.infoNode.innerText = `${BMSCost}\n${JSSortCost}`;
  }

  async readList(log = false) {
    await this.buffers.listStagingBuffer.mapAsync(GPUMapMode.READ);
    const output = new Float32Array(this.buffers.listStagingBuffer.getMappedRange()).slice();
    this.debug && log && console.log(output);
    this.buffers.listStagingBuffer.unmap();
    return output;
  }

  resize = debounce(async () => {
    if (this.inited) {
      await this.prepare();
      this.lastCompute = this.compute();
    }
  }, 200);

  async dispose() {
    this.inited = false;
    await this.lastCompute;
    this.buffers.listBuffer.destroy();
    this.buffers.listStagingBuffer.destroy();
    this.buffers.uniformBuffer.destroy();
  }
}

function drawBMSDiagram(arrLenPowerOfTwo: number, maxInvocationsPerWorkGroup: number) {
  const maxH = arrLenPowerOfTwo;

  // calc step indices
  let stepIndex = -1;
  let colCount = 0;
  const plotData: string[][] = []; // [col][row]
  const plot = (blockH: number, type: 'flip' | 'disperse') => {
    const blockCount = maxH / blockH;
    const blockW = blockH * 0.5;
    for (let block = 0; block < blockCount; block++) {
      for (let w = 0; w < blockW; w++) {
        const lineLen = type === 'flip' ? blockH - w * 2 : blockH * 0.5 + 1;
        const lineOffset = (block * blockH + w) * 2;
        const colOffset = colCount + w;
        plotData[colOffset] = plotData[colOffset] || [];
        plotData[colOffset][lineOffset] = '┳';
        plotData[colOffset][lineOffset + 1] = '┃';
        for (let l = 1; l < lineLen - 1; l++) {
          plotData[colOffset][lineOffset + l * 2] = '┃';
          plotData[colOffset][lineOffset + l * 2 + 1] = '┃';
        }
        plotData[colOffset][lineOffset + (lineLen - 1) * 2] = '┻';
        plotData[colOffset][lineOffset + (lineLen - 1) * 2 + 1] = ' ';
      }
    }
  };

  for (let upH = 2; upH <= maxH; upH *= 2) {
    stepIndex++;
    plot(upH, 'flip');
    colCount += 1 + upH * 0.5;

    for (let downH = upH * 0.5; downH >= 2; downH *= 0.5) {
      stepIndex++;
      plot(downH, 'disperse');
      colCount += 1 + downH * 0.5;
    }
  }

  // draw diagram
  console.log(`BMS arrLen: ${arrLenPowerOfTwo} step count: ${stepIndex + 1}`);
  const rowCount = maxH * 2;
  let plotStr = '';
  for (let row = 0; row < rowCount - 1; row++) {
    for (let col = 0; col < colCount - 1; col++) {
      plotStr += plotData[col] ? plotData[col][row] || ' ' : '\t';
    }
    plotStr += '\n';
  }
  console.log(plotStr);
}

function calcDispatch(arrLenPowerOfTwo: number, maxInvocationsPerWorkGroup: number) {
  const maxH = arrLenPowerOfTwo;

  let lastStepLen = 0;
  let ex = 0;
  let dispatchLen = 0;
  const maxParallelLen = maxInvocationsPerWorkGroup * 2;
  for (let len = 2; len <= maxH; len *= 2, ex++) {
    const currStepLen = lastStepLen + 1 + ex;
    lastStepLen = currStepLen;
    if (len < maxParallelLen) continue;
    else if (len === maxParallelLen) {
      console.log(`BMS local_bms\t l: ${len}\t ex: ${ex}`);
      dispatchLen++;
    } else {
      console.log(`BMS big_flip\t l: ${len}\t ex: ${ex}`);
      dispatchLen++;
      let downH = len * 0.5;
      for (; downH > maxParallelLen; downH *= 0.5) {
        console.log(`BMS big_disp\t l: ${downH}\t ex: ${ex}`);
        dispatchLen++;
      }
      console.log(`BMS local_disp\t l: ${downH}\t ex: ${ex}`);
      dispatchLen++;
    }
  }

  return dispatchLen;
}

function calcStepLen(maxH: number) {
  let stepIndex = -1;

  for (let upH = 2; upH <= maxH; upH *= 2) {
    stepIndex++;

    for (let downH = upH * 0.5; downH >= 2; downH *= 0.5) {
      stepIndex++;
    }
  }
  return stepIndex + 1;
}
