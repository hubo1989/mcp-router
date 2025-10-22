import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import { MCPServerConfig } from "@mcp_router/shared";
import { logInfo, logError } from "@/main/utils/logger";
import { processBundleFile } from "@/main/modules/mcp-server-manager/bundle-processor";

export type ConversionStatus = "queued" | "processing" | "completed" | "failed";

export interface ConversionJob {
  id: string;
  status: ConversionStatus;
  progress: number; // 0-100
  file: Uint8Array;
  fileName?: string;
  result?: MCPServerConfig;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

class ConversionQueueService {
  private jobs: Map<string, ConversionJob> = new Map();
  private queue: string[] = [];
  private processing = false;
  private emitter = new EventEmitter();

  enqueue(file: Uint8Array, fileName?: string): string {
    const id = uuidv4();
    const now = Date.now();
    const job: ConversionJob = {
      id,
      status: "queued",
      progress: 0,
      file,
      fileName,
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(id, job);
    this.queue.push(id);
    this.emitter.emit("update", { ...job });
    void this.processNext();
    return id;
  }

  async enqueueAndWait(file: Uint8Array, fileName?: string): Promise<MCPServerConfig> {
    const id = this.enqueue(file, fileName);
    return new Promise<MCPServerConfig>((resolve, reject) => {
      const onUpdate = (job: ConversionJob) => {
        if (job.id !== id) return;
        if (job.status === "completed" && job.result) {
          this.emitter.removeListener("update", onUpdate);
          resolve(job.result);
        } else if (job.status === "failed") {
          this.emitter.removeListener("update", onUpdate);
          reject(new Error(job.error || "Conversion failed"));
        }
      };
      this.emitter.on("update", onUpdate);
    });
  }

  getJob(id: string): ConversionJob | undefined {
    const job = this.jobs.get(id);
    return job ? { ...job } : undefined;
  }

  onUpdate(listener: (job: ConversionJob) => void): void {
    this.emitter.on("update", listener);
  }

  offUpdate(listener: (job: ConversionJob) => void): void {
    this.emitter.off("update", listener);
  }

  private async processNext(): Promise<void> {
    if (this.processing) return;
    const nextId = this.queue.shift();
    if (!nextId) return;

    const job = this.jobs.get(nextId);
    if (!job) return;

    this.processing = true;
    try {
      job.status = "processing";
      job.progress = 5;
      job.updatedAt = Date.now();
      this.emitter.emit("update", { ...job });
      logInfo("ConversionQueue: processing job " + job.id);

      // Process bundle file and convert to MCPServerConfig
      job.progress = 50;
      this.emitter.emit("update", { ...job });
      const result = await processBundleFile(job.file, job.fileName);

      job.progress = 100;
      job.status = "completed";
      job.result = result;
      job.updatedAt = Date.now();
      this.emitter.emit("update", { ...job });
      logInfo("ConversionQueue: job completed " + job.id);
    } catch (err: any) {
      job.status = "failed";
      job.error = err?.message || String(err);
      job.updatedAt = Date.now();
      this.emitter.emit("update", { ...job });
      logError("ConversionQueue: job failed " + job.id + ": " + job.error);
    } finally {
      this.processing = false;
      // process the next job
      void this.processNext();
    }
  }
}

export const conversionQueue = new ConversionQueueService();