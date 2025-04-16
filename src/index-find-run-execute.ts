import { Camunda8} from '@camunda8/sdk';
import chalk from 'chalk';
import { config } from 'dotenv';
import {ZeebeGrpcClient} from "@camunda8/sdk/dist/zeebe";
import {OperateApiClient} from "@camunda8/sdk/dist/operate";

// Initialize environment variables
config();

const TenantId: string = '<default>';
const BPMNProcessId: string = 'c8-sdk-demo';
const TaskAssignee: string = 'demo-app-assignee';

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
    private readonly bpmnProcessId = BPMNProcessId;

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
            const processDefinitions = await this.operate.searchProcessDefinitions({
                filter: {
                    bpmnProcessId: BPMNProcessId,
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
            const runningProcesses = await this.operate.searchProcessInstances({
                filter: {
                    bpmnProcessId: this.bpmnProcessId,
                    state: 'ACTIVE',
                    tenantId: TenantId,
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
            const process = await this.zbc.createProcessInstanceWithResult({
                bpmnProcessId: this.bpmnProcessId,
                variables,
                tenantId: TenantId,
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

// Helper function for worker logging
const getLogger = (prefix: string, color: any) => (msg: string) => console.log(color(`[${prefix}] ${msg}`));

// Application entry point
async function main(): Promise<void> {
    // Validate environment configuration
    const requiredEnvVars = [
        'ZEEBE_ADDRESS',
        'ZEEBE_CLIENT_ID',
        'ZEEBE_CLIENT_SECRET',
        'CAMUNDA_OPERATE_BASE_URL',
        'CAMUNDA_TASKLIST_BASE_URL'
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

    // Create logger
    const logger = new ChalkLogger('App');

    // Create service worker
    console.log(`Creating worker...`);
    zbc.createWorker({
        taskType: 'service-task',
        taskHandler: job => {

            const log = getLogger('Zeebe Worker', chalk.blueBright);
            log(`handling job of type ${job.type}`);

            return job.complete({
                serviceTaskOutcome: 'We did it!'
            });
        }
    });

    // Start human task poller
    console.log(`Starting human task poller...`);
    setInterval(async () => {
        const log = getLogger('Tasklist', chalk.yellowBright);
        try {
            const res = await tasklist.searchTasks({
                state: 'CREATED'
            });

            if (res.length > 0) {
                log(`fetched ${res.length} human tasks`);
                for (const task of res) {
                    try {
                        log(`claiming task ${task.id} from process ${task.processInstanceKey}`);
                        const t = await tasklist.assignTask({
                            taskId: task.id,
                            assignee: TaskAssignee,
                            allowOverrideAssignment: true
                        });

                        log(`servicing human task ${t.id} from process ${t.processInstanceKey}`);
                        await tasklist.completeTask(t.id, {
                            humanTaskStatus: 'Got done'
                        });
                    } catch (taskError) {
                        log(`Error processing task ${task.id}: ${taskError}`);
                    }
                }
            } else {
                log('No human tasks found');
            }
        } catch (searchError) {
            log(`Error searching for tasks: ${searchError}`);
        }
    }, 3000);

    try {
        logger.info('Starting application');

        // Get topology information
        const topology = await zbc.topology();
        logger.info('Connected to Zeebe cluster');

        // Get process definitions
        try {
            logger.info(`Searching for processes definition: ${BPMNProcessId}`);
            const processDefinitions = await operate.searchProcessDefinitions({
                filter: {
                    bpmnProcessId: BPMNProcessId
                },
                size: 100,
            });

            if (processDefinitions.items.length > 0) {
                logger.info(`Found process definition ${BPMNProcessId} with key: ${processDefinitions.items[0].key}`);
            } else {
                logger.warn('No process definitions ${BPMNProcessId} found');
            }
        } catch (error) {
            logger.error(`Error fetching process definitions for ${BPMNProcessId}: ${error}`);
        }

        // Get running processes
        try {
            const runningProcesses = await operate.searchProcessInstances({
                filter: {
                    bpmnProcessId: BPMNProcessId,
                    state: 'ACTIVE'
                },
                size: 100
            });

            if (runningProcesses.items.length > 0) {
                logger.info(`Found running process for ${BPMNProcessId} with key: ${runningProcesses.items[0].key}`);
            } else {
                logger.info(`No running processes found for ${BPMNProcessId}, creating new process instance ...`);

                // Create a new process instance
                const p = await zbc.createProcessInstanceWithResult({
                    bpmnProcessId: BPMNProcessId,
                    variables: {
                        humanTaskStatus: 'Needs doing'
                    }
                });

                logger.info(`Process for ${BPMNProcessId} was created with key: ${p.processInstanceKey}`);
            }
        } catch (error) {
            logger.error(`Error fetching process instances: ${error}`);
        }

        // Keep the application running for the workers and pollers
        logger.info('Application is now running with active workers and task pollers');
        // We don't close the Zeebe client since we want to keep the workers running

    } catch (error) {
        logger.error(`Application error: ${error}`);
        // Don't close the Zeebe client on errors either, as we want the workers to continue running
    }
}

// Execute the application
main();