const fs = require('fs-extra');
const path = require('path');
const pinyin = require("node-pinyin");
const utils = require('../utils/utils.js');

/**
 * 生成CopyWebpackPlugin所需要的数组的字符串
 * @param {*} assetsFolderObject  包含有静态文件的目录列表的对象
 */
function createStaticPlugin (assetsFolderObject) {
    var result = [];
    for (let item of assetsFolderObject.values()) {
        result.push(`{
					from: path.join(__dirname, 'src/${item}'),
					to: path.join(__dirname, 'dist', process.env.NODE_ENV === 'production' ? 'build' : 'dev', process.env.UNI_PLATFORM,
						'${item}'),
					ignore: ["*.vue", "*.js", "*.wxs", "*.css"]
				}`);
    }
    return result.join(",");
}


/**
 * 处理vue-cli项目配置文件
 * @param {*} configData           小程序配置数据
 * @param {*} outputFolder         输出目录
 * @param {*} assetsFolderObject   包含有静态文件的目录列表的对象
 * @param {*} isVueAppCliMode      是否为vue-cli模式，这里默认为true
 */
async function vueCliHandle (configData, outputFolder, assetsFolderObject, isVueAppCliMode) {

    try {
        await new Promise((resolve, reject) => {
            if (isVueAppCliMode) {
                const pathArray = [
                    {
                        source: "vue-cli/public/index.html",
                        target: "public/index.html"
                    },
                    {
                        source: "vue-cli/.gitignore",
                        target: ".gitignore"
                    },
                    {
                        source: "vue-cli/babel.config.js",
                        target: "babel.config.js"
                    },
                    {
                        source: "vue-cli/package.json",
                        target: "package.json",
                        raplaceArray: [
                            "<%= PROJECT_NAME %>"
                        ],
                    },
                    {
                        source: "vue-cli/postcss.config.js",
                        target: "postcss.config.js"
                    },
                    {
                        source: "vue-cli/README.md",
                        target: "README.md",
                        raplaceArray: [
                            "<%= PROJECT_NAME %>"
                        ],
                    },
                    {
                        source: "vue-cli/vue_config.js",
                        target: "vue.config.js",
                        raplaceArray: [
                            "<%= COPY_WEBPACK_PLUGIN %>"
                        ],
                    },
                    {
                        source: "vue-cli/tsconfig.json",
                        target: "tsconfig.json",
                    },
                ]

                for (const key in pathArray) {
                    const obj = pathArray[key];
                    const source = obj.source;
                    const target = obj.target;
                    const raplaceArray = obj.raplaceArray;
                    const file_source = path.join(__dirname, source);
                    const file_target = path.join(outputFolder, target);
                    if (raplaceArray) {
                        let fileContent = fs.readFileSync(file_source, 'utf-8');
                        for (const key2 in raplaceArray) {
                            const flag = raplaceArray[key2];
                            // utils.log(flag);
                            switch (flag) {
                                case "<%= PROJECT_NAME %>":
                                    //package.json里的name字段，有时会有中文，将导致npm i时报错，这里转换为拼音
                                    let name = pinyin(configData.name, { style: "normal" }).join("");
                                    fileContent = fileContent.replace(flag, name);
                                    break;
                                case "<%= COPY_WEBPACK_PLUGIN %>":
                                    fileContent = fileContent.replace(flag, createStaticPlugin(assetsFolderObject));
                                    break;
                                default:
                                    break;
                            }
                        }

                        fs.writeFileSync(file_target, fileContent);
                        utils.log(`write ${target} success!`);
                    } else {
                        fs.copySync(file_source, file_target);
                        utils.log(`copy ${target} success!`);
                    }
                }
            }

            //////////////////////////////////////////////////////////////////////
            resolve();
        });
    } catch (err) {
        utils.log(err);
    }
}

module.exports = vueCliHandle;
