'use strict';

const TYPE = require('../../types/mcdev.d');
const MetadataDefinitions = require('./../MetadataTypeDefinitions');
const packageJsonMcdev = require('../../package.json');
const process = require('node:process');
const toposort = require('toposort');
const winston = require('winston');
const child_process = require('node:child_process');

/**
 * Util that contains logger and simple util methods
 */
const Util = {
    authFileName: '.mcdev-auth.json',
    boilerplateDirectory: '../../boilerplate',
    configFileName: '.mcdevrc.json',
    parentBuName: '_ParentBU_',
    standardizedSplitChar: '/',
    /** @type {TYPE.skipInteraction} */
    skipInteraction: false,
    packageJsonMcdev: packageJsonMcdev,

    /**
     * helper that allows filtering an object by its keys
     *
     * @param {Object.<string,*>} originalObj object that you want to filter
     * @param {string[]} [whitelistArr] positive filter. if not provided, returns originalObj without filter
     * @returns {Object.<string,*>} filtered object that only contains keys you provided
     */
    filterObjByKeys(originalObj, whitelistArr) {
        if (!whitelistArr || !Array.isArray(whitelistArr)) {
            return originalObj;
        }
        return Object.keys(originalObj)
            .filter((key) => whitelistArr.includes(key))
            .reduce((obj, key) => {
                obj[key] = originalObj[key];
                return obj;
            }, {});
    },
    /**
     * extended Array.includes method that allows check if an array-element starts with a certain string
     *
     * @param {string[]} arr your array of strigns
     * @param {string} search the string you are looking for
     * @returns {boolean} found / not found
     */
    includesStartsWith(arr, search) {
        return this.includesStartsWithIndex(arr, search) >= 0;
    },
    /**
     * extended Array.includes method that allows check if an array-element starts with a certain string
     *
     * @param {string[]} arr your array of strigns
     * @param {string} search the string you are looking for
     * @returns {number} array index 0..n or -1 of not found
     */
    includesStartsWithIndex(arr, search) {
        return Array.isArray(arr) ? arr.findIndex((el) => el.startsWith(search)) : -1;
    },
    /**
     * check if a market name exists in current mcdev config
     *
     * @param {string} market market localizations
     * @param {TYPE.Mcdevrc} properties local mcdev config
     * @returns {boolean} found market or not
     */
    checkMarket(market, properties) {
        if (properties.markets[market]) {
            return true;
        } else {
            Util.logger.error(`Could not find the market '${market}' in your configuration file.`);
            const marketArr = Object.values(properties.markets);

            if (marketArr.length) {
                Util.logger.info('Available markets are: ' + marketArr.join(', '));
            }
            return false;
        }
    },
    /**
     * ensure provided MarketList exists and it's content including markets and BUs checks out
     *
     * @param {string} mlName name of marketList
     * @param {TYPE.Mcdevrc} properties General configuration to be used in retrieve
     * @returns {void} throws errors if problems were found
     */
    verifyMarketList(mlName, properties) {
        if (properties.marketList[mlName]) {
            // ML exists, check if it is properly set up

            // check if BUs in marketList are valid
            let buCounter = 0;
            for (const businessUnit in properties.marketList[mlName]) {
                if (businessUnit !== 'description') {
                    buCounter++;
                    const [cred, bu] = businessUnit ? businessUnit.split('/') : [null, null];
                    if (
                        !properties.credentials[cred] ||
                        !properties.credentials[cred].businessUnits[bu]
                    ) {
                        throw new Error(`'${businessUnit}' in Market ${mlName} is not defined.`);
                    }
                    // check if markets are valid
                    let marketArr = properties.marketList[mlName][businessUnit];
                    if ('string' === typeof marketArr) {
                        marketArr = [marketArr];
                    }
                    for (const market of marketArr) {
                        if (properties.markets[market]) {
                            // * markets can be empty or include variables. Nothing we can test here
                        } else {
                            throw new Error(`Market '${market}' is not defined.`);
                        }
                    }
                }
            }
            if (!buCounter) {
                throw new Error(`No BUs defined in marketList ${mlName}`);
            }
        } else {
            // ML does not exist
            throw new Error(`Market List ${mlName} is not defined`);
        }
    },
    /**
     * used to ensure the program tells surrounding software that an unrecoverable error occured
     *
     * @returns {void}
     */
    signalFatalError() {
        Util.logger.debug('Util.signalFataError() sets process.exitCode = 1');
        process.exitCode = 1;
    },
    /**
     * SFMC accepts multiple true values for Boolean attributes for which we are checking here
     *
     * @param {*} attrValue value
     * @returns {boolean} attribute value == true ? true : false
     */
    isTrue(attrValue) {
        return ['true', 'TRUE', 'True', '1', 1, 'Y', true].includes(attrValue);
    },
    /**
     * SFMC accepts multiple false values for Boolean attributes for which we are checking here
     *
     * @param {*} attrValue value
     * @returns {boolean} attribute value == false ? true : false
     */
    isFalse(attrValue) {
        return ['false', 'FALSE', 'False', '0', 0, 'N', false].includes(attrValue);
    },
    /**
     * helper for {@link Mcdev.retrieve}, {@link Mcdev.retrieveAsTemplate} and {@link Mcdev.deploy}
     *
     * @param {TYPE.SupportedMetadataTypes} selectedType type or type-subtype
     * @param {boolean} [handleOutside] if the API reponse is irregular this allows you to handle it outside of this generic method
     * @returns {boolean} type ok or not
     */
    _isValidType(selectedType, handleOutside) {
        const [type, subType] = Util.getTypeAndSubType(selectedType);
        if (type && !MetadataDefinitions[type]) {
            if (!handleOutside) {
                Util.logger.error(`:: '${type}' is not a valid metadata type`);
            }
            return false;
        } else if (
            type &&
            subType &&
            (!MetadataDefinitions[type] || !MetadataDefinitions[type].subTypes.includes(subType))
        ) {
            if (!handleOutside) {
                Util.logger.error(`:: '${selectedType}' is not a valid metadata type`);
            }
            return false;
        }
        return true;
    },

    /**
     * helper that deals with extracting type and subtype
     *
     * @param {string} selectedType "type" or "type-subtype"
     * @returns {string[]} first elem is type, second elem is subType
     */
    getTypeAndSubType(selectedType) {
        if (selectedType) {
            const temp = selectedType.split('-');
            const type = temp.shift(); // remove first item which is the main typ
            const subType = temp.join('-'); // subType can include "-"
            return [type, subType];
        } else {
            return [];
        }
    },

    /**
     * helper for getDefaultProperties()
     *
     * @returns {TYPE.SupportedMetadataTypes[]} type choices
     */
    getRetrieveTypeChoices() {
        const typeChoices = [];
        for (const el in MetadataDefinitions) {
            if (
                Array.isArray(MetadataDefinitions[el].typeRetrieveByDefault) ||
                MetadataDefinitions[el].typeRetrieveByDefault === true
            ) {
                // complex types like assets are saved as array but to ease upgradability we
                // save the main type only unless the user deviates from our pre-selection.
                // Types that dont have subtypes set this field to true or false
                typeChoices.push(MetadataDefinitions[el].type);
            }
        }

        typeChoices.sort((a, b) => {
            if (a.toLowerCase() < b.toLowerCase()) {
                return -1;
            }
            if (a.toLowerCase() > b.toLowerCase()) {
                return 1;
            }
            return 0;
        });

        return typeChoices;
    },

    loggerTransports: null,
    /**
     * Logger that creates timestamped log file in 'logs/' directory
     *
     * @type {TYPE.Logger}
     */
    logger: null,
    restartLogger: startLogger,
    /**
     * Logger helper for Metadata functions
     *
     * @param {string} level of log (error, info, warn)
     * @param {string} type of metadata being referenced
     * @param {string} method name which log was called from
     * @param {*} payload generic object which details the error
     * @param {string} [source] key/id of metadata which relates to error
     * @returns {void}
     */
    metadataLogger: function (level, type, method, payload, source) {
        let prependSource = '';
        if (source) {
            prependSource = source + ' - ';
        }
        if (payload instanceof Error) {
            // extract error message
            Util.logger[level](`${type}.${method}: ${prependSource}${payload.message}`);
        } else if (typeof payload === 'string') {
            // print out simple string
            Util.logger[level](`${type} ${method}: ${prependSource}${payload}`);
        } else {
            // Print out JSON String as default.
            Util.logger[level](`${type}.${method}: ${prependSource}${JSON.stringify(payload)}`);
        }
    },
    /**
     * replaces values in a JSON object string, based on a series of
     * key-value pairs (obj)
     *
     * @param {string | object} str JSON object or its stringified version, which has values to be replaced
     * @param {TYPE.TemplateMap} obj key value object which contains keys to be replaced and values to be replaced with
     * @returns {string | object} replaced version of str
     */
    replaceByObject: function (str, obj) {
        let convertType = false;
        if ('string' !== typeof str) {
            convertType = true;
            str = JSON.stringify(str);
        }
        // sort by value length
        const sortable = [];
        for (const key in obj) {
            // only push in value if not null
            if (obj[key]) {
                sortable.push([key, obj[key]]);
            }
        }

        sortable.sort((a, b) => b[1].length - a[1].length);
        for (const pair of sortable) {
            const escVal = pair[1].toString().replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
            const regString = new RegExp(escVal, 'g');
            str = str.replace(regString, '{{{' + pair[0] + '}}}');
        }
        if (convertType) {
            str = JSON.parse(str);
        }
        return str;
    },
    /**
     * get key of an object based on the first matching value
     *
     * @param {object} objs object of objects to be searched
     * @param {string} val value to be searched for
     * @returns {string} key
     */
    inverseGet: function (objs, val) {
        for (const obj in objs) {
            if (objs[obj] === val) {
                return obj;
            }
        }
        throw new Error(`${val} not found in object`);
    },

    /**
     * Returns Order in which metadata needs to be retrieved/deployed
     *
     * @param {string[]} metadataTypes which should be retrieved/deployed
     * @returns {Object.<string, string[]>} retrieve/deploy order as array
     */
    getMetadataHierachy(metadataTypes) {
        const dependencies = [];
        // loop through all metadata types which are being retrieved/deployed
        const subTypeDeps = {};
        for (const metadataType of metadataTypes) {
            const type = metadataType.split('-')[0];
            // if they have dependencies then add a dependency pair for each type
            if (MetadataDefinitions[type].dependencies.length > 0) {
                dependencies.push(
                    ...MetadataDefinitions[type].dependencies.map((dep) => {
                        if (dep.includes('-')) {
                            // log subtypes to be able to replace them if main type is also present
                            subTypeDeps[dep.split('-')[0]] =
                                subTypeDeps[dep.split('-')[0]] || new Set();
                            subTypeDeps[dep.split('-')[0]].add(dep);
                        }
                        return [dep, metadataType];
                    })
                );
            }
            // if they have no dependencies then just add them with undefined.
            else {
                dependencies.push([undefined, metadataType]);
            }
        }
        const allDeps = dependencies.map((dep) => dep[0]);
        // remove subtypes if main type is in the list
        for (const type of Object.keys(subTypeDeps)
            // only look at subtype deps that are also supposed to be retrieved or cached fully
            .filter((type) => metadataTypes.includes(type) || allDeps.includes(type))) {
            // convert set into array to walk its elements
            for (const subType of subTypeDeps[type]) {
                for (const item of dependencies) {
                    if (item[0] === subType) {
                        // if subtype recognized, replace with main type
                        item[0] = type;
                    }
                }
            }
        }

        // sort list & remove the undefined dependencies
        const flatList = toposort(dependencies).filter((a) => !!a);
        const finalList = {};
        // group subtypes per type
        for (const type of flatList) {
            if (type.includes('-')) {
                const [key, subKey] = Util.getTypeAndSubType(type);
                if (finalList[key] === null) {
                    // if main type is already required, then don't filter by subtypes
                    continue;
                } else if (finalList[key] && subKey) {
                    // add another subtype to the set
                    finalList[key].add(subKey);
                    continue;
                } else {
                    // create a new set with the first subtype; subKey will be always set here
                    finalList[key] = new Set([subKey]);
                }
                if (subTypeDeps[key]) {
                    // check if there are depndent subtypes that need to be added
                    const temp = [...subTypeDeps[key]].map((a) => {
                        const temp = a.split('-');
                        temp.shift(); // remove first item which is the main type
                        return temp.join('-'); // subType can include "-"
                    });
                    finalList[key].add(...temp);
                }
            } else {
                finalList[type] = null;
            }
        }
        // convert sets into arrays
        for (const type of Object.keys(finalList)) {
            if (finalList[type] instanceof Set) {
                finalList[type] = [...finalList[type]];
            }
        }

        return finalList;
    },

    /**
     * let's you dynamically walk down an object and get a value
     *
     * @param {string} path 'fieldA.fieldB.fieldC'
     * @param {object} obj some parent object
     * @returns {any} value of obj.path
     */
    resolveObjPath(path, obj) {
        return path.split('.').reduce((prev, curr) => (prev ? prev[curr] : null), obj);
    },
    /**
     * helper to run other commands as if run manually by user
     *
     * @param {string} cmd to be executed command
     * @param {string[]} [args] list of arguments
     * @param {boolean} [hideOutput] if true, output of command will be hidden from CLI
     * @returns {string} output of command if hideOutput is true
     */
    execSync(cmd, args, hideOutput) {
        args = args || [];
        Util.logger.info('⚡ ' + cmd + ' ' + args.join(' '));

        if (hideOutput) {
            // no output displayed to user but instead returned to parsed elsewhere
            return child_process
                .execSync(cmd + ' ' + args.join(' '))
                .toString()
                .trim();
        } else {
            // the following options ensure the user sees the same output and
            // interaction options as if the command was manually run
            child_process.execSync(cmd + ' ' + args.join(' '), { stdio: [0, 1, 2] });
            return null;
        }
    },
    /**
     * standardize check to ensure only one result is returned from template search
     *
     * @param {TYPE.MetadataTypeItem[]} results array of metadata
     * @param {string} keyToSearch the field which contains the searched value
     * @param {string} searchValue the value which is being looked for
     * @returns {TYPE.MetadataTypeItem} metadata to be used in building template
     */
    templateSearchResult(results, keyToSearch, searchValue) {
        const matching = results.filter((item) => item[keyToSearch] === searchValue);

        if (matching.length === 0) {
            throw new Error(`No metadata found with name "${searchValue}"`);
        } else if (matching.length > 1) {
            throw new Error(
                `Multiple metadata with name "${searchValue}" please rename to be unique to avoid issues`
            );
        } else {
            return matching[0];
        }
    },
    /**
     * configures what is displayed in the console
     *
     * @param {object} argv list of command line parameters given by user
     * @param {boolean} [argv.silent] only errors printed to CLI
     * @param {boolean} [argv.verbose] chatty user CLI output
     * @param {boolean} [argv.debug] enables developer output & features
     * @returns {void}
     */
    setLoggingLevel(argv) {
        Util.loggerTransports.console.file = 'debug';
        if (argv.silent) {
            // only errors printed to CLI
            Util.logger.level = 'error';
            Util.loggerTransports.console.level = 'error';
            Util.logger.debug('CLI logger set to: silent');
        } else if (argv.verbose) {
            // chatty user cli logs
            Util.logger.level = 'verbose';
            Util.loggerTransports.console.level = 'verbose';
            Util.logger.debug('CLI logger set to: verbose');
        } else {
            // default user cli logs
            // TODO to be switched to "warn" when cli-process is integrated
            Util.logger.level = 'info';
            Util.loggerTransports.console.level = 'info';
            Util.logger.debug('CLI logger set to: info / default');
        }
        if (argv.debug) {
            // enables developer output & features. no change to actual logs
            Util.logger.level = 'debug';
            Util.loggerTransports.console.level = 'debug';
            Util.logger.debug('CLI logger set to: debug');
        }
    },
    /**
     * outputs a warning that the given type is still in beta
     *
     * @param {string} type api name of the type thats in beta
     */
    logBeta(type) {
        Util.logger.warn(
            ` - ${type} support is currently still in beta. Please report any issues here: https://github.com/Accenture/sfmc-devtools/issues/new/choose`
        );
    },
    // defined colors for logging things in different colors
    color: {
        reset: '\x1B[0m',
        dim: '\x1B[2m',
        bright: '\x1B[1m',
        underscore: '\x1B[4m',
        blink: '\x1B[5m',
        reverse: '\x1B[7m',
        hidden: '\x1B[8m',

        fgBlack: '\x1B[30m',
        fgRed: '\x1B[31m',
        fgGreen: '\x1B[32m',
        fgYellow: '\x1B[33m',
        fgBlue: '\x1B[34m',
        fgMagenta: '\x1B[35m',
        fgCyan: '\x1B[36m',
        fgWhite: '\x1B[37m',
        fgGray: '\x1B[90m',

        bgBlack: '\x1B[40m',
        bgRed: '\x1B[41m',
        bgGreen: '\x1B[42m',
        bgYellow: '\x1B[43m',
        bgBlue: '\x1B[44m',
        bgMagenta: '\x1B[45m',
        bgCyan: '\x1B[46m',
        bgWhite: '\x1B[47m',
        bgGray: '\x1B[100m',
    },
    /**
     * helper that wraps a message in the correct color codes to have them printed gray
     *
     * @param {string} msg log message that should be wrapped with color codes
     * @returns {string} gray msg
     */
    getGrayMsg(msg) {
        return `${Util.color.dim}${msg}${Util.color.reset}`;
    },
    /**
     * helper to print the subtypes we filtered by
     *
     * @param {string[]} subTypeArr list of subtypes to be printed
     * @returns {void}
     */
    logSubtypes(subTypeArr) {
        if (subTypeArr && subTypeArr.length > 0) {
            Util.logger.info(
                Util.getGrayMsg(
                    ` - Subtype${subTypeArr.length > 1 ? 's' : ''}: ${subTypeArr.join(', ')}`
                )
            );
        }
    },
    /**
     * helper to print the subtypes we filtered by
     *
     * @param {string[] | string} keyArr list of subtypes to be printed
     * @param {boolean} [isId] optional flag to indicate if key is an id
     * @returns {string} string to be appended to log message
     */
    getKeysString(keyArr, isId) {
        if (!keyArr) {
            return '';
        }
        if (!Array.isArray(keyArr)) {
            // if only one key, make it an array
            keyArr = [keyArr];
        }
        if (keyArr.length > 0) {
            return Util.getGrayMsg(
                ` - ${isId ? 'ID' : 'Key'}${keyArr.length > 1 ? 's' : ''}: ${keyArr.join(', ')}`
            );
        }
        return '';
    },
    /**
     * pause execution of code; useful when multiple server calls are dependent on each other and might not be executed right away
     *
     * @param {number} ms time in miliseconds to wait
     * @returns {Promise.<void>} - promise to wait for
     */
    async sleep(ms) {
        return new Promise((resolve) => {
            setTimeout(resolve, ms);
        });
    },
    /**
     * helper for {@link Asset._extractCode} and {@link Script.prepExtractedCode} to determine if a code block is a valid SSJS block
     *
     * @example the following is invalid:
     * <script runat="server">
     *       // 1
     *   </script>
     *   <script runat="server">
     *       // 2
     *   </script>
     *
     *   the following is valid:
     *   <script runat="server">
     *       // 3
     *   </script>
     * @param {string} code code block to check
     * @returns {string} the SSJS code if code block is a valid SSJS block, otherwise null
     */
    getSsjs(code) {
        if (!code) {
            return null;
        }
        // \s*      whitespace characters, zero or more times
        // [^>]*?   any character that is not a >, zero or more times, un-greedily
        // (.*)     capture any character, zero or more times
        // /ms      multiline and dotall flags
        // ideally the code looks like <script runat="server">...</script>
        const scriptRegex = /^<\s*script [^>]*?>(.*)<\/\s*script\s*>$/ms;
        code = code.trim();
        const regexMatches = scriptRegex.exec(code);
        if (regexMatches?.length > 1) {
            // script found
            /* eslint-disable unicorn/prefer-ternary */
            if (regexMatches[1].includes('<script')) {
                // nested script found
                return null;
            } else {
                // no nested script found
                return regexMatches[1];
            }
            /* eslint-enable unicorn/prefer-ternary */
        }
        // no script found
        return null;
    },
};
/**
 * wrapper around our standard winston logging to console and logfile
 *
 * @returns {object} initiated logger for console and file
 */
function createNewLoggerTransport() {
    // {
    //   error: 0,
    //   warn: 1,
    //   info: 2,
    //   http: 3,
    //   verbose: 4,
    //   debug: 5,
    //   silly: 6
    // }
    const logFileName = new Date().toISOString().split(':').join('.');
    return {
        console: new winston.transports.Console({
            // Write logs to Console
            level: 'info', // log error, warn, info
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.timestamp({ format: 'HH:mm:ss' }),
                winston.format.simple(),
                winston.format.printf((info) => `${info.timestamp} ${info.level}: ${info.message}`)
            ),
        }),
        file: new winston.transports.File({
            // Write logs to logfile
            filename: 'logs/' + logFileName + '.log',
            level: 'debug', // log everything
            format: winston.format.combine(
                winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
                winston.format.simple(),
                winston.format.printf((info) => `${info.timestamp} ${info.level}: ${info.message}`)
            ),
        }),
        fileError: new winston.transports.File({
            // Write logs to additional error-logfile for better visibility of errors
            filename: 'logs/' + logFileName + '-errors.log',
            level: 'error', // only log errors
            format: winston.format.combine(
                winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
                winston.format.simple(),
                winston.format.printf((info) => `${info.timestamp} ${info.level}: ${info.message}`)
            ),
        }),
    };
}
/**
 * initiate winston logger
 *
 * @returns {void}
 */
function startLogger() {
    Util.loggerTransports = createNewLoggerTransport();
    const myWinston = winston.createLogger({
        levels: winston.config.npm.levels,
        transports: [
            Util.loggerTransports.console,
            Util.loggerTransports.file,
            Util.loggerTransports.fileError,
        ],
    });
    const winstonError = myWinston.error;
    const winstonExtension = {
        /**
         * helper that prints better stack trace for errors
         *
         * @param {Error} ex the error
         * @param {string} [message] optional custom message to be printed as error together with the exception's message
         * @returns {void}
         */
        errorStack: function (ex, message) {
            if (message) {
                // ! this method only sets exitCode=1 if message-param was set
                // if not, then this method purely outputs debug information and should not change the exitCode
                winstonError(message + ':');
                winstonError(`    ${ex.message} (${ex.code})`);
                if (ex.endpoint) {
                    // ex.endpoint is only available if 'ex' is of type RestError
                    winstonError('    endpoint: ' + ex.endpoint);
                }
                Util.signalFatalError();
            }
            let stack;
            /* eslint-disable unicorn/prefer-ternary */
            if (
                ['ETIMEDOUT', 'EHOSTUNREACH', 'ENOTFOUND', 'ECONNRESET', 'ECONNABORTED'].includes(
                    ex.code
                )
            ) {
                // the stack would just return a one-liner that does not help
                stack = new Error().stack; // eslint-disable-line unicorn/error-message
            } else {
                stack = ex.stack;
            }
            /* eslint-enable unicorn/prefer-ternary */
            myWinston.debug(stack);
        },
        /**
         * errors should cause surrounding applications to take notice
         * hence we overwrite the default error function here
         *
         * @param {string} msg - the message to log
         * @returns {void}
         */
        error: function (msg) {
            winstonError(msg);
            Util.signalFatalError();
        },
    };
    Util.logger = Object.assign(myWinston, winstonExtension);

    Util.logger.debug(`:: mcdev ${packageJsonMcdev.version} ::`);
}
startLogger();

module.exports = Util;
