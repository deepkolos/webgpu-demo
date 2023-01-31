import { adapter, device, queue } from '../context';
import { GenOptions, Refs, Els, Options } from '../ui';
import { Demo } from './demo';
import BMSComputeShader from '../shaders/bms.compute.wgsl?raw';
import arrayShuffle from 'array-shuffle';

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
  lastCompute!: Promise<void>;
  bindGroupLayout!: GPUBindGroupLayout;
  uniformBuffer!: GPUBuffer;
  invocNum = 4;
  opts!: { invocation: number; dataSize: number };
  listData!: number[];
  csm!: GPUShaderModule;

  async init(refs: Refs, genOptions: GenOptions): Promise<void> {
    // layout
    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
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

    this.csm = device.createShaderModule({ code: BMSComputeShader });

    this.bindGroupLayout = bindGroupLayout;
    this.uniformBuffer = uniformBuffer;

    this.opts = { invocation: 8, dataSize: 24 };

    await this.prepare();
    this.lastCompute = this.compute();

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
        range: [1, 24],
        onChange: async (v: number, els: Els, opt: Options, optName: string) => {
          this.opts.dataSize = v;
          els.label.innerText = `${optName}(${Math.pow(2, v)})`;
          await this.prepare();
          this.lastCompute = this.compute();
        },
      },
    });
  }

  async prepare() {
    await this.lastCompute;
    this.buffers?.listBuffer.destroy();
    this.buffers?.listStagingBuffer.destroy();
    // this.buffers?.uniformBuffer.destroy();

    const invocNum = Math.pow(2, this.opts.invocation);
    const dataSize = Math.pow(2, this.opts.dataSize);

    if (dataSize <= 32) drawBMSDiagram(dataSize, invocNum);
    else if (this.debug) console.log('BMS will not draw when data size exceed 32');

    calcDispatch(dataSize, invocNum);

    const pipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] }),
      compute: {
        module: this.csm,
        entryPoint: 'main',
        constants: { invoc_num: invocNum, invoc_h: invocNum * 2 },
      },
    });

    const listData = new Array(dataSize)
      .fill(0)
      .map((v, k) => k)
      .sort((a, b) => b - a);

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

    this.buffers = { listBuffer, listStagingBuffer, uniformBuffer: this.uniformBuffer };
    this.listLen = dataSize;
    this.bindGroup = bindGroup;
    this.pipeline = pipeline;
    this.invocNum = invocNum;
  }

  async dispatch(workgroupX: number, kernel: Kernel, workH: number) {
    this.debug && console.log(`BMS dispatch kernel: ${kernel} workH: ${workH}`);
    const ubo = new Uint32Array([kernel, workH]);
    queue.writeBuffer(this.buffers.uniformBuffer, 0, ubo.buffer, ubo.byteOffset, ubo.byteLength);
    const commandEncoder = device.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass({});
    passEncoder.setPipeline(this.pipeline);
    passEncoder.setBindGroup(0, this.bindGroup);
    passEncoder.dispatchWorkgroups(workgroupX);
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
  }

  async compute() {
    const startT = performance.now();
    const workgroupX = Math.ceil((this.listLen * 0.5) / this.invocNum);
    console.log('workgroupX', workgroupX);

    // calc dispatch
    let lastStepLen = 0;
    let ex = 0;
    const maxParallelLen = this.invocNum * 2;
    for (let len = 2; len <= this.listLen; len *= 2, ex++) {
      const currStepLen = lastStepLen + 1 + ex;
      lastStepLen = currStepLen;
      if (len < maxParallelLen) continue;
      else if (len === maxParallelLen) {
        await this.dispatch(workgroupX, Kernel.local_bms, len);
      } else {
        await this.dispatch(workgroupX, Kernel.storage_flip_once, len);
        let downH = len * 0.5;
        for (; downH > maxParallelLen; downH *= 0.5) {
          await this.dispatch(workgroupX, Kernel.storage_disp_once, downH);
        }
        await this.dispatch(workgroupX, Kernel.local_disp, downH);
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
    console.log(
      'BMS Compute',
      performance
        .measure('BMS Compute', {
          start: startT,
          end: endT,
        })
        .duration.toFixed(2) + 'ms',
    );

    this.listData.sort((a, b) => a - b);
    console.log(
      'JS Sort',
      performance
        .measure('JS Sort', {
          start: endT,
          end: performance.now(),
        })
        .duration.toFixed(2) + 'ms',
    );
  }

  async readList(log = false) {
    await this.buffers.listStagingBuffer.mapAsync(GPUMapMode.READ);
    const output = new Float32Array(this.buffers.listStagingBuffer.getMappedRange()).slice();
    this.debug && log && console.log(output);
    this.buffers.listStagingBuffer.unmap();
    return output;
  }

  resize(): void {}
  async dispose() {
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
  const maxParallelLen = maxInvocationsPerWorkGroup * 2;
  for (let len = 2; len <= maxH; len *= 2, ex++) {
    const currStepLen = lastStepLen + 1 + ex;
    lastStepLen = currStepLen;
    if (len < maxParallelLen) continue;
    else if (len === maxParallelLen) {
      console.log(`BMS local_bms\t l: ${len}\t ex: ${ex}`);
    } else {
      console.log(`BMS big_flip\t l: ${len}\t ex: ${ex}`);
      let downH = len * 0.5;
      for (; downH > maxParallelLen; downH *= 0.5) {
        console.log(`BMS big_disp\t l: ${downH}\t ex: ${ex}`);
      }
      console.log(`BMS local_disp\t l: ${downH}\t ex: ${ex}`);
    }
  }
}
