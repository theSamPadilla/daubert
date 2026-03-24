import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { spawn } from 'child_process';
import { ScriptRunEntity } from '../../../database/entities/script-run.entity';

const TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 100 * 1024; // 100KB

export interface ScriptResult {
  status: 'success' | 'error' | 'timeout';
  output: string;
  durationMs: number;
}

@Injectable()
export class ScriptExecutionService {
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(ScriptRunEntity)
    private readonly scriptRunRepo: Repository<ScriptRunEntity>,
  ) {}

  async execute(
    investigationId: string,
    name: string,
    code: string,
  ): Promise<ScriptResult & { savedRun: ScriptRunEntity }> {
    const result = await this.runInChildProcess(code);

    const savedRun = await this.scriptRunRepo.save(
      this.scriptRunRepo.create({
        investigationId,
        name,
        code,
        output: result.output,
        status: result.status,
        durationMs: result.durationMs,
      }),
    );

    return { ...result, savedRun };
  }

  async listRuns(investigationId: string): Promise<ScriptRunEntity[]> {
    return this.scriptRunRepo.find({
      where: { investigationId },
      order: { createdAt: 'DESC' },
      take: 20,
    });
  }

  private runInChildProcess(code: string): Promise<ScriptResult> {
    return new Promise((resolve) => {
      const start = Date.now();

      // Wrap agent code in async IIFE with try/catch so top-level await works
      const harness = `
(async () => {
  try {
${code}
  } catch (err) {
    console.error(err?.message ?? err);
    process.exitCode = 1;
  }
})();
`.trim();

      const env: Record<string, string> = {
        HOME: process.env.HOME || '',
        PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
        NODE_PATH: process.env.NODE_PATH || '',
      };
      const ethKey = this.configService.get<string>('ETHERSCAN_API_KEY');
      const tronKey = this.configService.get<string>('TRONSCAN_API_KEY');
      if (ethKey) env.ETHERSCAN_API_KEY = ethKey;
      if (tronKey) env.TRONSCAN_API_KEY = tronKey;
      env.API_URL = this.configService.get<string>('API_URL') || 'http://localhost:8081';

      const child = spawn(process.execPath, ['--input-type=module', '-'], {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: TIMEOUT_MS,
      });

      let output = '';
      let killed = false;

      const appendOutput = (chunk: Buffer) => {
        if (killed) return;
        output += chunk.toString();
        if (Buffer.byteLength(output) > MAX_OUTPUT_BYTES) {
          output = output.slice(0, MAX_OUTPUT_BYTES) + '\n...[truncated at 100KB]';
          killed = true;
          child.kill('SIGKILL');
        }
      };

      child.stdout.on('data', appendOutput);
      child.stderr.on('data', appendOutput);

      // Send code via stdin
      child.stdin.write(harness);
      child.stdin.end();

      child.on('close', (exitCode, signal) => {
        const durationMs = Date.now() - start;

        let status: ScriptResult['status'] = 'success';
        if (signal === 'SIGTERM' || signal === 'SIGKILL' || durationMs >= TIMEOUT_MS) {
          status = 'timeout';
          if (!output.includes('[truncated')) {
            output += '\n...[killed: timeout after 30s]';
          }
        } else if (exitCode !== 0) {
          status = 'error';
        }

        resolve({ status, output: output.trim(), durationMs });
      });

      child.on('error', (err) => {
        resolve({
          status: 'error',
          output: `Failed to spawn process: ${err.message}`,
          durationMs: Date.now() - start,
        });
      });
    });
  }
}
