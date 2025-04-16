import { Camunda8} from '@camunda8/sdk';
import chalk from 'chalk';
import { config } from 'dotenv';
import {ZeebeGrpcClient} from "@camunda8/sdk/dist/zeebe";
import {OperateApiClient} from "@camunda8/sdk/dist/operate";

// Initialize environment variables
config();

// Define interfaces for better type safety
interface Logger {
    info: (message: string) => void;
    error: (message: string) => void;
    warn: (message: string) => void;
}

interface ProcessService {
    getProcessDefinitions(): Promise<any>;
    getRunningProcesses(): Promise<any>;
    createProcessInstance(variables: Record<string, any>): Promise<any>;
    close(): Promise<void>;
}

// Create a proper logger with consistent methods
class ChalkLogger implements Logger {
    private readonly prefix: string;

    constructor(prefix: string) {
        this.prefix = prefix;
    }

    info(message: string): void {
        console.log(chalk.greenBright(`[${this.prefix}] ${message}`));
    }

    error(message: string): void {
        console.error(chalk.redBright(`[${this.prefix}] ${message}`));
    }

    warn(message: string): void {
        console.warn(chalk.yellowBright(`[${this.prefix}] ${message}`));
    }
}

// Create a service class following Domain Model pattern
class CamundaProcessService implements ProcessService {
    private readonly zbc: ZeebeGrpcClient;
    private readonly operate: OperateApiClient;
    private readonly logger: Logger;
    private readonly bpmnProcessId = 'c8-sdk-demo';

    constructor(
        zbc: ZeebeGrpcClient,
        operate: OperateApiClient,
        logger: Logger
    ) {
        this.zbc = zbc;
        this.operate = operate;
        this.logger = logger;
    }

    async getProcessDefinitions(): Promise<any> {
        try {
            this.logger.info('getProcessDefinitions');

            const processDefinitions = await this.operate.searchProcessDefinitions({
                filter: {
                    bpmnProcessId: this.bpmnProcessId
                },
                size: 100,
            });

            return processDefinitions;
        } catch (error) {
            this.logger.error(`Failed to fetch process definitions: ${error}`);
            throw error;
        }
    }

    async getRunningProcesses(): Promise<any> {
        try {
            this.logger.info('getRunningProcesses');

            const runningProcesses = await this.operate.searchProcessInstances({
                filter: {
                    bpmnProcessId: this.bpmnProcessId,
                    state: 'ACTIVE'
                },
                size: 100
            });

            return runningProcesses;
        } catch (error) {
            this.logger.error(`Failed to fetch running processes: ${error}`);
            throw error;
        }
    }

    async createProcessInstance(variables: Record<string, any>): Promise<any> {
        try {
            this.logger.info('createProcessInstance');

            const process = await this.zbc.createProcessInstanceWithResult({
                bpmnProcessId: this.bpmnProcessId,
                variables,
                requestTimeout: 120000 // 120 seconds in milliseconds
            });

            return process;
        } catch (error) {
            this.logger.error(`Failed to create process instance: ${error}`);
            throw error;
        }
    }

    async close(): Promise<void> {
        await this.zbc.close();
    }
}

// Main application class
class Application {
    private readonly logger: Logger;
    private readonly processService: ProcessService;

    constructor(logger: Logger, processService: ProcessService) {
        this.logger = logger;
        this.processService = processService;
    }

    async run(): Promise<void> {
        try {
            this.logger.info('Starting application');

            // Get process definitions
            const processDefinitions = await this.processService.getProcessDefinitions();
            if (processDefinitions.items.length > 0) {
                this.logger.info(`Found process definition with key: ${processDefinitions.items[0].key}`);
            } else {
                this.logger.warn('No process definitions found');
            }

            // Get running processes
            const runningProcesses = await this.processService.getRunningProcesses();
            if (runningProcesses.items.length > 0) {
                this.logger.info(`Found running process with key: ${runningProcesses.items[0].key}`);
            } else {
                this.logger.info('No running processes found, creating new process instance');

                // Create a new process instance
                const process = await this.processService.createProcessInstance({
                    humanTaskStatus: 'Needs doing'
                });

                this.logger.info(`Created process instance with key: ${process.processInstanceKey}`);
            }

        } catch (error) {
            this.logger.error(`Application error: ${error}`);
            throw error;
        } finally {
            // Ensure resources are cleaned up
            await this.processService.close();
            this.logger.info('Application terminated');
        }
    }
}

const getLogger = (prefix: string, color: any) => (msg: string) => console.log(color(`[${prefix}] ${msg}`));

// Application entry point
async function main(): Promise<void> {
    // Validate environment configuration
    const requiredEnvVars = [
        'ZEEBE_ADDRESS',
        'ZEEBE_CLIENT_ID',
        'ZEEBE_CLIENT_SECRET',
        'CAMUNDA_OPERATE_BASE_URL'
    ];

    const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
    if (missingEnvVars.length > 0) {
        console.error(chalk.redBright(`Missing required environment variables: ${missingEnvVars.join(', ')}`));
        process.exit(1);
    }

    // Initialize Camunda clients
    const c8 = new Camunda8();
    const zbc = c8.getZeebeGrpcApiClient();
    const operate = c8.getOperateApiClient();
    const tasklist = c8.getTasklistApiClient();

    // Create logger and service
    const logger = new ChalkLogger('App');
    const processService = new CamundaProcessService(zbc, operate, new ChalkLogger('ProcessService'));

    // Run application
    const app = new Application(logger, processService);

    try {
        await app.run();
    } catch (error) {
        logger.error(`Fatal error: ${error}`);
        process.exit(1);
    }

}

// Execute the application
main();