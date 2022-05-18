import chalk from 'chalk';


const main = () => {
    let branchName = process.argv[2];
    console.log(branchName, process.argv);
    if (!branchName) {
        error("No branch name specified", true);
    }
    console.log(chalk.yellow("Hey Fam"))
}

const printHelp = () => {

}

const error = (message, printHelp = false) => {
    console.log(chalk.red(message));
    if (printHelp) {
        printHelp();
    }
    throw new Error(message)
}

main();