import {Camunda8} from '@camunda8/sdk'
import chalk from 'chalk'
import {config} from 'dotenv'


config()

const c8 = new Camunda8()
const zbc = c8.getZeebeGrpcApiClient()
const operate = c8.getOperateApiClient()
const optimize = c8.getOptimizeApiClient() // unused
const tasklist = c8.getTasklistApiClient()

const getLogger = (prefix: string, color: any) => (msg: string) => console.log(color(`[${prefix}] ${msg}`))

async function main() {
    const log = getLogger('Zeebe', chalk.greenBright)


    log(`Hello `)
    try {
        // Get deployed processes
        const topology = await zbc.topology();
        //console.log('Topology:', JSON.stringify(topology, null, 2));

        // const processes = await getDeployedProcesses();
        // console.log('Deployed processes:', JSON.stringify(processes, null, 2));

        try {
            const processDefinitions = await operate.searchProcessDefinitions({
                filter: {
                    bpmnProcessId: 'c8-sdk-demo'
                },
                size: 100, // Adjust the size as needed
            });

            console.log('Process Definitions:', processDefinitions.items);

            if (processDefinitions.items.length > 0) {
                console.log('Process Definitions:', processDefinitions.items[0].key);
            }

        } catch (error) {
            console.error('Error fetching process definitions:', error);
        }


        try {
            const runningProcesses = await operate.searchProcessInstances({
                filter: {
                    bpmnProcessId: 'c8-sdk-demo',
                    state: 'ACTIVE' // This filters for running instances
                },
                size: 100 // Adjust as needed
            });
            console.log('Running processes:', JSON.stringify(runningProcesses, null, 2));

            if (runningProcesses.items.length > 0) {
                console.log('Running processes:', JSON.stringify(runningProcesses.items[0].key, null, 2));
            } else {
                const p = await zbc.createProcessInstanceWithResult({
                    bpmnProcessId: `c8-sdk-demo`,
                    variables: {
                        humanTaskStatus: 'Needs doing'
                    }
                })
                console.log('Process was created : ', p.processInstanceKey);
            }

        } catch (error) {
            console.error('Error fetching process instances:', error);
        }


    } catch (error) {
        console.error('Error getting deployed resources:', error);
        throw error;
    } finally {
        // Close the client when done
        await zbc.close();
    }


}

main()