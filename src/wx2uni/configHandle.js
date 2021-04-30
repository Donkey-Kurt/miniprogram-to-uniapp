const fs = require('fs-extra')
const path = require('path')
const t = require('@babel/types')
const generate = require('@babel/generator').default

const utils = require('../utils/utils.js')
const pathUtil = require('../utils/pathUtil.js')

const pinyin = require("node-pinyin")

const clone = require('clone')


/**
 * 将小程序subPackages节点处理为uni-app所需要的节点
 * @param {*} subPackages
 */
function subPackagesHandle (subPackages, routerData) {
    let reuslt = []
    for (const key in subPackages) {
        const obj = subPackages[key]
        const root = obj.root
        const pages = obj.pages

        let newPages = []
        for (const subKey in pages) {
            const subObj = pages[subKey]

            let absKey = root + subObj
            let style = {}
            if (routerData[absKey]) {
                style = routerData[absKey]
            }
            delete style.usingComponents

            newPages.push({
                "path": subObj,
                "style": {
                    ...style
                }
            })
        }

        reuslt.push({
            "root": root,
            "pages": newPages
        })
    }
    return reuslt
}

/**
 * 处理配置文件
 * 生成配置文件: pages.json、manifest.json、main.js
 * @param {*} configData        小程序配置数据
 * @param {*} routerData        所有的路由页面数据
 * @param {*} miniprogramRoot   小程序主体所在目录
 * @param {*} targetFolder      最终要生成的目录
 */
async function configHandle (configData, routerData, miniprogramRoot, targetFolder) {
    try {
        await new Promise((resolve, reject) => {
            ////////////////////////////write pages.json/////////////////////////////

            //app.json文件路径
            let json_app = path.join(miniprogramRoot, "app.json")
            let appJson = {
                "pages": {},
                "tabBar": {},
                "globalStyle": {},
                "usingComponents": {},
            }
            if (fs.existsSync(json_app)) {
                appJson = fs.readJsonSync(json_app)
            } else {
                let str = "[Error] 找不到app.json文件(不影响转换)"
                utils.log(str)
                global.log.push("\r\n" + str + "\r\n")
            }
            //app.json里面引用的全局组件
            let globalUsingComponents = appJson.usingComponents || {}

            //判断是否加载了vant
            // global.hasVant = Object.keys(globalUsingComponents).some(key => {
            //     return utils.isVant(key);
            // }) || global.hasVant;

            //将pages节点里的数据，提取routerData对应的标题，写入到pages节点里
            let pages = []
            for (const key in appJson.pages) {
                let pagePath = appJson.pages[key] || ""
                pagePath = utils.normalizePath(pagePath)
                let data = routerData[pagePath]

                // let usingComponents = {};

                // if (data && JSON.stringify(data) != "{}") {
                // 	usingComponents = data.usingComponents;
                // }

                let obj
                let dataBak = {}
                if (data) {
                    dataBak = clone(data)
                    if (!global.hasVant) {
                        delete dataBak.usingComponents
                    }
                }
                obj = {
                    "path": pagePath,
                    "style": {
                        ...dataBak
                    }
                }
                pages.push(obj)
            }
            appJson.pages = pages

            //替换window节点为globalStyle
            appJson["globalStyle"] = clone(appJson["window"] || {})
            delete appJson["window"]

            //判断是否引用了vant
            if (global.hasVant) {
                // let usingComponentsVant = {};
                // for (const key in appJson["usingComponents"]) {
                // 	if (utils.vantComponentList[key]) {
                // 		usingComponentsVant[key] = utils.vantComponentList[key];
                // 	}
                // }

                appJson["globalStyle"]["usingComponents"] = utils.vantComponentList
            }

            //sitemap.json似乎在uniapp用不上，删除！
            // delete appJson["sitemapLocation"];

            //处理分包加载subPackages
            let subPackages = appJson["subPackages"] || appJson["subpackages"]
            appJson["subPackages"] = subPackagesHandle(subPackages, routerData)
            delete appJson["subpackages"]

            //usingComponents节点，上面删除缓存，这里删除
            delete appJson["usingComponents"]

            //workers处理，简单处理一下
            if (appJson["workers"]) appJson["workers"] = "static/" + appJson["workers"]

            //tabBar节点
            //将iconPath引用的图标路径进行修复
            let tabBar = appJson["tabBar"]
            if (tabBar && tabBar.list && tabBar.list.length) {
                for (const key in tabBar.list) {
                    let item = tabBar.list[key]

                    let iconPath = item.iconPath
                    let selectedIconPath = item.selectedIconPath
                    if (global.isTransformAssetsPath) {
                        item.iconPath = pathUtil.getAssetsNewPath(iconPath)
                        item.selectedIconPath = pathUtil.getAssetsNewPath(selectedIconPath)
                    } else {
                        //没毛用，先放这里。uniapp发布的时候居然不复制根目录下面的文件了。。。
                        if (iconPath.indexOf("static/") === -1 || selectedIconPath.indexOf("static/") === -1) {
                            //如果这两个路径都没有在static目录下，那就复制文件到static目录，并转换路径
                            let iconAbsPath = path.join(global.miniprogramRoot, iconPath)
                            let selectedIconAbsPath = path.join(global.miniprogramRoot, selectedIconPath)
                            //
                            let targetIconAbsPath = path.join(global.targetFolder, "static", iconPath)
                            let targetSelectedIconAbsPath = path.join(global.targetFolder, "static", selectedIconPath)
                            //
                            if (!fs.existsSync(targetIconAbsPath)) fs.copySync(iconAbsPath, targetIconAbsPath)
                            if (!fs.existsSync(targetSelectedIconAbsPath)) fs.copySync(selectedIconAbsPath, targetSelectedIconAbsPath)
                            //
                            item.iconPath = path.relative(global.targetFolder, targetIconAbsPath)
                            item.selectedIconPath = path.relative(global.targetFolder, targetIconAbsPath)
                        }
                    }
                }
            }

            //写入pages.json
            let file_pages = path.join(targetFolder, "pages.json")
            fs.writeFileSync(file_pages, JSON.stringify(appJson, null, '\t'))
            utils.log(`write ${ path.relative(global.targetFolder, file_pages) } success!`)

            ////////////////////////////write manifest.json/////////////////////////////

            //注：因json里不能含有注释，因些project-template/manifest.json文件里的注释已经被删除。
            let file_manifest = path.join(__dirname, "/project-template/mani_fest.json")
            let manifestJson = fs.readJsonSync(file_manifest)
            //
            let name = pinyin(configData.name, {
                style: "normal"
            }).join("")
            manifestJson.name = name
            manifestJson.description = configData.description
            manifestJson.versionName = configData.version || "1.0.0"
            //
            if (appJson["networkTimeout"]) {
                manifestJson["networkTimeout"] = appJson["networkTimeout"]
            }

            let mpWeixin = manifestJson["mp-weixin"]
            mpWeixin.appid = configData.appid
            if (appJson["plugins"]) {
                mpWeixin["plugins"] = appJson["plugins"]
            }
            if (configData["cloudfunctionRoot"]) {
                mpWeixin["cloudfunctionRoot"] = configData["cloudfunctionRoot"]
            }
            if (configData["setting"] || appJson["setting"]) {
                mpWeixin["setting"] = appJson["setting"] || configData["setting"]
            }
            if (configData["plugins"] || appJson["plugins"]) {
                mpWeixin["plugins"] = appJson["plugins"] || configData["plugins"]
            }
            if (configData["functionalPages"] || appJson["functionalPages"]) {
                mpWeixin["functionalPages"] = appJson["functionalPages"] || configData["functionalPages"]
            }
            if (appJson["globalStyle"] && appJson["globalStyle"].resizable) {
                mpWeixin["resizable"] = appJson["globalStyle"].resizable
            }
            if (appJson["navigateToMiniProgramAppIdList"]) {
                mpWeixin["navigateToMiniProgramAppIdList"] = appJson["navigateToMiniProgramAppIdList"] || configData["navigateToMiniProgramAppIdList"]
            }

            if (appJson["requiredBackgroundModes"]) {
                mpWeixin["requiredBackgroundModes"] = appJson["requiredBackgroundModes"] || configData["requiredBackgroundModes"]
            }

            if (appJson["permission"]) {
                mpWeixin["permission"] = appJson["permission"] || configData["permission"]
            }

            //manifest.json
            file_manifest = path.join(targetFolder, "manifest.json")
            fs.writeFileSync(file_manifest, JSON.stringify(manifestJson, null, '\t'))
            utils.log(`write ${ path.relative(global.targetFolder, file_manifest) } success!`)

            ////////////////////////////write main.js/////////////////////////////
            let mainContent = "import Vue from 'vue';\r\n"
            mainContent += "import App from './App';\r\n\r\n"

            //store
            if (global.isCompiledProject && global.compiledData.store) {
                mainContent += "import store from './store/store.js';\r\n\r\n"
            }

            //polyfill folder
            const sourcePolyfill = path.join(__dirname, '/project-template/polyfill')
            const targetPolyfill = path.join(targetFolder, 'polyfill')
            fs.copySync(sourcePolyfill, targetPolyfill)


            //引入polyfill，用户自行决定是否需要polyfill
            mainContent += "// Api函数polyfill（目前为实验版本，如不需要，可删除！）';\r\n"
            mainContent += "import Polyfill from './polyfill/polyfill';\r\n"
            mainContent += "Polyfill.init();\r\n\r\n"

            //全局mixins
            mainContent += "// 全局mixins，用于实现setData等功能';\r\n"
            mainContent += "import Mixin from './polyfill/mixins';\r\n"
            mainContent += "Vue.mixin(Mixin);\r\n\r\n"


            //全局引入自定义组件
            //import firstcompoent from '../firstcompoent/firstcompoent'
            for (const key in globalUsingComponents) {
                if (global.hasVant && (utils.isVant(key) || utils.isVant(globalUsingComponents[key]))) {

                } else {
                    //key可能含有后缀名，也可能是用-连接的，统统转成驼峰
                    let newKey = utils.toCamel2(key)
                    newKey = newKey.split(".vue").join("") //去掉后缀名
                    let filePath = globalUsingComponents[key]
                    let extname = path.extname(filePath)
                    if (extname) filePath = filePath.replace(extname, ".vue")
                    filePath = filePath.replace(/^\//, "./") //相对路径处理
                    let node = t.importDeclaration([t.importDefaultSpecifier(t.identifier(newKey))], t.stringLiteral(filePath))
                    mainContent += `${ generate(node).code }\r\n`
                    mainContent += `Vue.component("${ key }", ${ newKey });\r\n\r\n`
                }
            }

            //
            mainContent += "Vue.config.productionTip = false;\r\n\r\n"

            mainContent += "App.mpType = 'app';\r\n\r\n"
            mainContent += "const app = new Vue({\r\n"
            //store
            if (global.isCompiledProject && global.compiledData.store) {
                mainContent += "    store,\r\n"
            }

            mainContent += "    ...App\r\n"
            mainContent += "});\r\n"
            mainContent += "app.$mount();\r\n"
            //
            let file_main = path.join(targetFolder, "main.js")
            fs.writeFileSync(file_main, mainContent)
            utils.log(`write ${ path.relative(global.targetFolder, file_main) } success!`)


            /**
             *
             *
             * 这个文件需安装copy插件，一堆文件
             * TODO
             *
             *
             *
             */
            ////////////////////////////write vue.config.js/////////////////////////////
            //vue.config.js
            // let vueConfigSrcPath = path.join(__dirname, "/project-template/vue.config.js")
            // let vueConfigPath = path.join(targetFolder, "vue.config.js")
            // fs.copySync(vueConfigSrcPath, vueConfigPath)
            // utils.log(`write ${ path.relative(global.targetFolder, vueConfigPath) } success!`)

            //////////////////////////////////////////////////////////////////////
            resolve()
        })
    } catch (err) {
        utils.log(err)
    }
}

module.exports = configHandle
