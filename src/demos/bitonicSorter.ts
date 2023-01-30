import { GenOptions, Refs } from '../ui';
import { Demo } from './demo';

export class DemoBitonicSorter implements Demo {
  name = 'BitonicSorter';
  preview = '';

  async init(refs: Refs, genOptions: GenOptions): Promise<void> {
    drawBMSDiagram(32, 4);
  }
  resize(): void {}
  dispose(): void {}
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

  // calc dispatch
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
