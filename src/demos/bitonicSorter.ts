import { GenOptions, Refs } from '../ui';
import { Demo } from './demo';

export class DemoBitonicSorter implements Demo {
  name = 'BitonicSorter';
  preview = '';

  async init(refs: Refs, genOptions: GenOptions): Promise<void> {
    drawBMSDiagram(16, [2, 2, 2], 4);
  }
  resize(): void {}
  dispose(): void {}
}

function drawBMSDiagram(
  arrLenPowerOfTwo: number,
  maxWorkGroupSize: [number, number, number],
  maxInvocationsPerWorkGroup: number,
) {
  const invocationsNeedPerStep = arrLenPowerOfTwo * 0.5;
  const maxH = arrLenPowerOfTwo;
  const maxInvocationsPerWorkGroupPO2 = Math.pow(2, ~~Math.log2(maxInvocationsPerWorkGroup));
  const dispatchArgsMap = new Map<
    number,
    { invocation: number; workgroup: [number, number, number] }
  >();

  const getDispatchArgs = (h: number) => {
    let dispatchArgs = dispatchArgsMap.get(h);
    if (!dispatchArgs) {
      if (invocationsNeedPerStep <= maxInvocationsPerWorkGroupPO2) {
        dispatchArgs = { invocation: invocationsNeedPerStep, workgroup: [1, 1, 1] };
      } else {
        const workgroupTotalSize = invocationsNeedPerStep / maxInvocationsPerWorkGroupPO2;
        const invocation = maxInvocationsPerWorkGroupPO2;
        const [x, y, z] = maxWorkGroupSize;
        // 均分到x y z限制里
        if (x >= workgroupTotalSize) {
          dispatchArgs = { invocation, workgroup: [workgroupTotalSize, 1, 1] };
        } else if (x + y >= workgroupTotalSize) {
          dispatchArgs = { invocation, workgroup: [x, workgroupTotalSize - x, 1] };
        } else if (x + y + z >= workgroupTotalSize) {
          dispatchArgs = { invocation, workgroup: [x, y, workgroupTotalSize - x - y] };
        } else {
          throw new Error('get dispatch args fail: invocations exceed limitations');
          // 一个step被分配到多个也是可以?
        }
      }
      dispatchArgsMap.set(h, dispatchArgs);
    }
    return dispatchArgs;
  };

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
    const dispatchArgs = getDispatchArgs(upH);
    console.log('BMS step', stepIndex, upH, dispatchArgs);
    plot(upH, 'flip');
    colCount += 1 + upH * 0.5;

    for (let downH = upH * 0.5; downH >= 2; downH *= 0.5) {
      stepIndex++;
      const dispatchArgs = getDispatchArgs(downH);
      console.log('BMS step', stepIndex, downH, dispatchArgs);
      plot(downH, 'disperse');
      colCount += 1 + downH * 0.5;
    }
  }
  console.log('BMS step count', stepIndex + 1);

  // draw diagram
  const rowCount = maxH * 2;
  console.log('BMS plot', `${rowCount}x${colCount}`);

  let plotStr = '';
  for (let row = 0; row < rowCount - 1; row++) {
    for (let col = 0; col < colCount - 1; col++) {
      if (plotData[col]) {
        plotStr += plotData[col][row] || ' ';
      } else {
        plotStr += '\t';
      }
    }
    plotStr += '\n';
  }
  console.log(plotStr);
}
