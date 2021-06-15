const path = require('path')
const fs = require('fs-extra')
//
const utils = require('./utils/utils.js')
const pathUtil = require('./utils/pathUtil.js')
//

const jsHandle = require('./wx2uni/jsHandle')
const wxmlHandle = require('./wx2uni/wxmlHandle')
const cssHandle = require('./wx2uni/cssHandle')
const configHandle = require('./wx2uni/configHandle')
const vueCliHandle = require('./wx2uni/vueCliHandle')

const wxsHandle = require('./wx2uni/wxs/wxsHandle')
const combineWxsHandle = require('./wx2uni/wxs/combineWxsHandle')

const projectHandle = require('./wx2uni/project/projectHandle')

const TemplateParser = require('./wx2uni/wxml/TemplateParser')
//初始化一个解析器
const templateParser = new TemplateParser()

const MAX_FILE_SIZE = 500 * 1024

//文件组数据
//数据结构为：
// {
// 	"js": "",
// 	"wxml": "",
// 	"wxss": "",
// 	"folder": "",  //所在目录
// 	"json": "",
// 	"fileName": "",  //文件名，不含后缀
// }
let fileData = {}
//路由数据，用来记录对应页面的title和使用的自定义组件
let routerData = {}
//忽略处理或已经处理的目录
let ignoreFolder = []
//workers目录
let workersFolder = ''


const questions = [{
    q: "为什么不将 this.setData({a:1}) 转换为 this.a = 1 呢?",
    a: "已做polyfill，转换后可正常使用setData函数(见main.js文件)"
}, {
    q: "getApp()能在Uni-app里面使用吗？",
    a: "可以的，Uni-app早已支持"
}, {
    q: "为什么转换后我的资源文件都不见了？",
    a: "已将所有非static目录下面的资源文件都移入到static目录里"
}, {
    q: "小程序转换为Uni-app项目后，还能转换成其他小程序项目吗？",
    a: "当然可以，必须可以！Uni-app项目可以编译到各种小程序、H5和APP等平台"
}, {
    q: "为什么小程序运行正常，而转换到Uni-app后报了这么多错误呢？",
    a: "很正常。Uni-app与小程序无法一一对应，且代码写法千变万化，工具也无法预测所有情况，只能尽力做到更少的报错、更好的兼容。有问题可以添加qq group(780359397、361784059)进行交流"
}]



/**
 * 遍历目录
 * @param {*} folder           当前要遍历的目录
 * @param {*} miniprogramRoot  小程序主体所在目录
 * @param {*} targetFolder     生成目录
 * @param {*} callback         回调函数
 */
function traverseFolder (folder, miniprogramRoot, targetFolder, callback) {
    fs.readdir(folder, function (err, files) {
        var count = 0
        var checkEnd = function () {
            ++count == files.length && callback()
        }
        var tFolder = path.join(
            targetFolder,
            path.relative(miniprogramRoot, folder)
        )
        files.forEach(function (fileName) {
            var fileDir = path.join(folder, fileName)
            let newFileDir = path.join(tFolder, fileName)
            let isContinue = false
            fs.stat(fileDir, function (err, stats) {
                if (stats.isDirectory()) {
                    //简单判断是否为workers目录，严格判断需要从app.json里取出workers的路径来(后续再议)
                    let isWorkersFolder =
                        path.relative(miniprogramRoot, fileDir) === 'workers'

                    //判断是否含有wxParse目录
                    global.hasWxParse =
                        global.hasWxParse ||
                        fileName.toLowerCase() === 'wxparse'
                    if (global.isVueAppCliMode) {
                        /**
                         * 规则
                         * 1.保持原目录不变
                         * 2.找到资源时，保存路径（相对路径）
                         * 3.
                         */
                        if (isWorkersFolder) {
                            //处理workers目录，复制到static目录里
                            fs.copySync(
                                fileDir,
                                path.join(
                                    targetFolder,
                                    'static' + '/' + fileName
                                )
                            )
                            workersFolder = fileDir
                        } else {
                            pathUtil.mkdirsSync(newFileDir)
                        }
                    } else {
                        // utils.log("目录", fileDir, fileName);
                        //判断是否为页面文件所在的目录（这个判断仍然还不够十分完美~）
                        let isPageFileFolder = fs.existsSync(
                            path.join(fileDir, fileName + '.wxml')
                        )

                        if (isWorkersFolder) {
                            //处理workers目录，复制到static目录里
                            fs.copySync(
                                fileDir,
                                path.join(
                                    targetFolder,
                                    'static' + '/' + fileName
                                )
                            )
                            workersFolder = fileDir
                        } else if (fileName === 'wxParse') {
                            fs.copySync(fileDir, newFileDir)
                            // ignoreFolder.push(fileDir)
                        } else {
                            //如果不是是素材目录或workers目录下面的子目录就复制
                            let isInIgnoreFolder =
                                pathUtil.isInFolder(ignoreFolder, fileDir) ||
                                (workersFolder &&
                                    fileDir.indexOf(workersFolder) > -1)
                            if (isInIgnoreFolder) {
                                //
                            } else {
                                if (!fs.existsSync(newFileDir))
                                    pathUtil.mkdirsSync(newFileDir)
                            }
                        }
                    }
                    //继续往下面遍历
                    return traverseFolder(
                        fileDir,
                        miniprogramRoot,
                        targetFolder,
                        checkEnd
                    )
                } else {
                    //utils.log(stats)
                    /*not use ignore files*/
                    if (fileName[0] == '.' || fileName === "project.config.json") {
                    } else {
                        //判断是否含有wxParse文件
                        global.hasWxParse =
                            global.hasWxParse ||
                            fileName.indexOf('wxParse.') > -1
                        // utils.log("文件 ", fileDir, fileName);

                        //这里处理一下，防止目录名与文件名不一致
                        let extname = path.extname(fileName).toLowerCase()
                        let fileNameNoExt = pathUtil.getFileNameNoExt(fileName)
                        //
                        let obj = {}

                        //为了适应小程序里的app.json/pages节点的特点，这里也使用同样的规则，key为去掉后缀名的路径
                        // var key = path.join(tFolder, fileNameNoExt);
                        let key = pathUtil.getFileKey(fileDir)

                        if (utils.extnameReg.test(extname)) {
                            //如果obj为false，那么肯定是还没有初始化的underfined
                            if (!fileData[key]) {
                                fileData[key] = {
                                    js: '',
                                    wxml: '',
                                    wxss: '',
                                    folder: '',
                                    json: '',
                                    fileName: '',
                                    isAppFile: false,
                                    jsFileSize: 0
                                }
                            }
                            obj = fileData[key]
                            obj['folder'] = tFolder
                            obj['fileName'] = fileNameNoExt
                            //标识是否为app.js入口文件
                            //为兼容hbuilder插件，去除路径斜杠再进行对比
                            const isAppFile =
                                path.dirname(fileDir).replace(/\\|\//g, '') ==
                                global.miniprogramRoot.replace(/\\|\//g, '') &&
                                fileName == 'app.js'
                            obj['isAppFile'] = isAppFile || obj['isAppFile']
                            if (extname === '.js') {
                                obj['jsFileSize'] = stats.size
                            }
                        }
                        switch (extname) {
                            case '.js':
                                obj['js'] = fileDir
                                break
                            case '.wxml':
                            case '.qml':
                            case '.ttml':
                            case '.axml':
                            case '.swan':
                                global.mpType = utils.getMPType(extname)
                                global.mpTypeName = utils.mpInfo[global.mpType].keyword
                                obj['wxml'] = fileDir
                                break
                            case '.wxss':
                            case '.qss':
                            case '.ttss':
                            case '.acss':
                                obj['wxss'] = fileDir
                                break
                            case '.json':
                                //粗暴获取上层目录的名称~~~
                                let pFolderName = pathUtil.getParentFolderName(
                                    fileDir
                                )
                                if (
                                    fileNameNoExt !== pFolderName &&
                                    fileName != 'app.json' &&
                                    fileName != 'index.json'
                                ) {
                                    fs.copySync(fileDir, newFileDir)
                                }

                                ///这里要判断是文件名是否为上层目录名，如果是的话就可以
                                obj['json'] = fileDir
                                break
                            case '.wxs':
                                (async function (fileDir, newFileDir) {
                                    const fileContent = await combineWxsHandle(
                                        fileDir,
                                        newFileDir
                                    )
                                    // fs.copySync(fileDir, newFileDir);

                                    //写入文件
                                    fs.writeFileSync(newFileDir, fileContent)
                                    const relWxsFile = path.relative(global.miniprogramRoot, newFileDir)
                                    utils.log(`Convert wxs file ${ relWxsFile } success!`)
                                    global.log.push(`Convert wxs file ${ relWxsFile } success!`)
                                })(fileDir, newFileDir)
                                break
                            default:
                                // utils.log(extname, path.dirname(fileDir));
                                // utils.log(fileDir, path.basename(path.dirname(fileDir)));
                                if (/.(jpe?g|gif|svg|png|mp3)$/.test(extname)) {
                                    //当前文件上层目录
                                    let pFolder = path.dirname(fileDir)

                                    if (global.isVueAppCliMode) {
                                        let relFolder = path.relative(
                                            miniprogramRoot,
                                            pFolder
                                        )
                                        let key = relFolder.replace(/\\/g, '/')
                                        global.assetsFolderObject.add(key)
                                        fs.copySync(fileDir, newFileDir)
                                    } else {

                                        if (global.isTransformAssetsPath) {
                                            let relPath = path.relative(
                                                global.miniprogramRoot,
                                                fileDir
                                            )
                                            relPath = utils.normalizePath(relPath)
                                            if (!global.assetInfo[relPath])
                                                global.assetInfo[relPath] = {}
                                            global.assetInfo[relPath][
                                                'oldPath'
                                            ] = fileDir
                                            let targetFile = path.join(
                                                targetFolder,
                                                'static',
                                                relPath
                                            )
                                            global.assetInfo[relPath][
                                                'newPath'
                                            ] = targetFile

                                            fs.copySync(fileDir, targetFile)
                                        } else {
                                            fs.copySync(fileDir, newFileDir)
                                        }
                                    }
                                } else {
                                    fs.copySync(fileDir, newFileDir)
                                }
                                break
                        }
                    }
                    checkEnd()
                }
            })
        })

        //为空时直接回调
        files.length === 0 && callback()
    })
}

/**
 * 处理一组文件（js、wxml、wxss）
 * @param {*} fileData         一组文件数据(即同名的js/wxml/wxss为一组数据)
 * @param {*} miniprogramRoot  小程序主体所在目录
 */
async function filesHandle (fileData, miniprogramRoot) {
    // utils.log("--------------", tFolder);
    try {
        return await new Promise((resolve, reject) => {
            let total = Object.keys(fileData).length
            let count = 0

            for (let key in fileData) {
                (async function (key) {
                    let fileContent = ''
                    let obj = fileData[key]
                    let file_js = obj['js']
                    let file_wxml = obj['wxml']
                    let file_wxss = obj['wxss']
                    let file_json = obj['json']
                    let tFolder = obj['folder']
                    let fileName = obj['fileName']
                    let isAppFile = obj['isAppFile']
                    let jsFileSize = obj['jsFileSize']
                    //
                    if (!fs.existsSync(tFolder)) {
                        pathUtil.mkdirsSync(tFolder)
                    }

                    // * 单个情况：
                    // * 单个wxml的情况-->转换为vue
                    // * 单个wxss的情况-->重名为css
                    // * 单个js的情况-->直接复制
                    var extName = ''
                    var hasAllFile = false
                    var onlyJSFile = false
                    var onlyWxssFile = false
                    var onlyWxmlFile = false

                    //如果是app，满足js和wxss也行
                    let isAllFile = ((file_wxml && file_js) ||
                        (file_wxml && file_wxss) ||
                        ((isAppFile || /\bcommon[\\|\/]main\.js/.test(file_js)) && (file_js && file_wxss)))

                    if (file_js.indexOf("we-cropper.") > -1) {
                        let logStr = "[Error] 检测项目中可能引用wx-cropper，请转换后自行到DCloud插件市场，选择钟意的“图片裁剪插件”进行替换   file-> " + path.relative(global.miniprogramRoot, file_js)
                        global.log.push(logStr)
                        utils.log(logStr)

                        isAllFile = false
                    }

                    if (isAllFile || isAppFile) {
                        //当有wxml，那必然会有js文件，可能会有wxss文件，单独的.wxml，转为.vue
                        //可能也会有“仅有app.js和app.wxss”的情况，所以要多加一个判断
                        extName = '.vue'
                        hasAllFile = true
                    } else {
                        if (file_wxml) {
                            //如果只有一个wxml，就当它是一个组件来处理
                            extName = '.vue'
                            onlyWxmlFile = true
                        }
                        if (file_js) {
                            //除了上面至少两种文件存在的情况，那么这里就是单独存在的js文件
                            extName = '.js'
                            onlyJSFile = true
                        }

                        if (file_wxss) {
                            //与js文件类似，这里只可能是单独存在的wxss文件
                            extName = '.css'
                            onlyWxssFile = true
                        }
                    }
                    //
                    //组装文件名
                    let targetFilePath = path.join(tFolder, fileName + extName)
                    if (isAppFile)
                        targetFilePath = path.join(tFolder, 'App.vue')

                    //当前文件引用的自定义组件
                    let usingComponents = {}

                    //取key，理论随便哪个文件都能取到。
                    let fileKey = pathUtil.getFileKey(file_js || file_wxml)

                    if (fileKey) {
                        //存入全局对象
                        if (!global.pagesData[fileKey])
                            global.pagesData[fileKey] = {}

                        global.pagesData[fileKey]['data'] = {
                            type: 'all',
                            path: targetFilePath
                        }
                    }

                    //解析json
                    if (file_json) {
                        try {
                            let data = fs.readJsonSync(file_json)
                            //判断是否有引用自定义组件
                            if (
                                !data.usingComponents ||
                                JSON.stringify(data.usingComponents) == '{}'
                            ) {
                                data.usingComponents = {}
                            }

                            //判断是否加载了vant
                            // global.hasVant = Object.keys(data.usingComponents).some(key => {
                            //     return utils.isVant(key);
                            // }) || global.hasVant;

                            if (!global.hasVant) {
                                //处理根路径
                                for (const kk in data.usingComponents) {
                                    let value = data.usingComponents[kk]
                                    //plugin是微信自定义组件
                                    if (value.indexOf('plugin:') > -1 ||
                                        value.indexOf('plugin-private:') > -1
                                    ) {
                                        //TODO: 应该要放进manifest文件里。。。！！！！
                                        // "subscribe": "plugin-private://wx2b03c6e691cd7370/components/subscribe/subscribe"
                                        const logStr = `[Tip]  项目添加了微信小程序特有组件，已删除！     ${ kk }:  ${ value }      file:  ${ path.relative(global.miniprogramRoot, file_js) }`
                                        utils.log(logStr)
                                        global.log.push(logStr)

                                        delete data.usingComponents[kk]
                                    } else {
                                        let fileDir = path.dirname(file_json)

                                        if (
                                            global.dependencies &&
                                            global.dependencies[value] &&
                                            !/\.\//.test(value)
                                        ) {
                                            //处理 "datepicker": "miniprogram-datepicker"  这种情况
                                            //没有.也没有/，并且是在dependencies里有记录的。
                                            let absPath = path.join(
                                                global.miniprogram_npm,
                                                value
                                            )
                                            value = path.relative(fileDir, absPath)
                                        } else {
                                            value = pathUtil.relativePath(
                                                value,
                                                global.miniprogramRoot,
                                                fileDir
                                            )
                                        }
                                        data.usingComponents[kk] = value
                                    }
                                }
                            }

                            routerData[key] = data
                            usingComponents = data.usingComponents
                            if (fileKey)
                                global.pagesData[fileKey]['data']['component'] =
                                    data['component']
                        } catch (error) {
                            utils.log(error)
                            global.log.push('[Error] ' + error)
                        }
                    }

                    if (hasAllFile) {
                        let fileContentWxml = ''
                        let fileContentMinWxml = ''
                        let fileContentJs = ''
                        let fileContentCss = ''
                        let curFileData = global.pagesData[fileKey]['data']

                        if (fileKey) {
                            curFileData['type'] = 'all'
                            curFileData['wxml'] = ''
                            curFileData['wxmlData'] = ''
                            curFileData['minWxml'] = ''
                            curFileData['js'] = ''
                            curFileData['jsData'] = ''
                            curFileData['css'] = ''
                            curFileData['attribs'] = null
                        }

                        let wxmlData = null
                        //读取.wxml文件
                        if (file_wxml && fs.existsSync(file_wxml)) {
                            let data_wxml = fs.readFileSync(file_wxml, 'utf8')
                            if (data_wxml) {
                                wxmlData = await wxmlHandle(data_wxml, file_wxml, false)

                                fileContentWxml = wxmlData.templateString
                                fileContentMinWxml = wxmlData.templateStringMin
                                wxsInfoHandle(tFolder, file_wxml)
                            } else {
                                //存个空标签
                                fileContentWxml = '<template>\r\n<view>\r\n</view>\r\n</template>\r\n'

                                wxmlData = {
                                    fileContentWxml
                                }
                            }

                            if (fileKey) {
                                curFileData['wxml'] = fileContentWxml
                                curFileData['minWxml'] = fileContentMinWxml
                                curFileData['wxmlData'] = wxmlData
                            }
                        }

                        //读取.js文件
                        if (file_js && fs.existsSync(file_js)) {
                            let jsData = null
                            let data_js = fs.readFileSync(file_js, 'utf8')
                            if (data_js) {
                                if (global.hasVant && fileKey != 'app') {
                                    let componentStr = ''
                                    let wxVueOptions = []
                                    for (const name in usingComponents) {
                                        if (global.hasVant && utils.isVant(name)) {
                                            //vant组件
                                        } else {
                                            let value = usingComponents[name]
                                            let newName = utils.toCamel2(name)
                                            componentStr += `import ${ newName } from '${ value }'\r\n`
                                            wxVueOptions.push(
                                                `'${ name }': ${ newName }`
                                            )
                                        }
                                    }
                                    if (wxVueOptions.length) {
                                        componentStr += `global['__wxVueOptions'] = {components:{${ wxVueOptions.join(
                                            ','
                                        ) }}};`
                                    }

                                    fileContentJs = `
									<script>
										${ componentStr }
										global['__wxRoute'] = '${ fileKey }';
										${ data_js }
										export default global['__wxComponents']['${ fileKey }'];
									</script>
									`.replace(/\t+/g, '')
                                } else {
                                    // const { codeText: data, newFile } = await jsHandle(
                                    jsData = await jsHandle(
                                        data_js,
                                        usingComponents,
                                        file_js,
                                        onlyJSFile,
                                        isAppFile
                                    )

                                    fileContentJs = jsData.fileContent
                                    file_js = jsData.newFile

                                    //根据与data变量重名的函数名，将wxml里引用的地方进行替换
                                    fileContentWxml = replaceFunName(
                                        fileContentWxml,
                                        pathUtil.getFileKey(file_js)
                                    )
                                    fileContentMinWxml = replaceFunName(
                                        fileContentMinWxml,
                                        pathUtil.getFileKey(file_js)
                                    )

                                    if (fileKey) {
                                        curFileData['wxml'] = fileContentWxml
                                        curFileData['minWxml'] = fileContentMinWxml
                                        curFileData['wxmlData'] = wxmlData
                                    }
                                }
                                if (fileKey) {
                                    curFileData['js'] = fileContentJs
                                    curFileData['jsData'] = jsData

                                }
                            }
                        }

                        //读取.wxss文件
                        if (file_wxss && fs.existsSync(file_wxss)) {
                            let data_wxss = fs.readFileSync(file_wxss, 'utf8')
                            const cssFilePath = path.join(
                                tFolder,
                                fileName + '.css'
                            )
                            //这里不判断，wxss为空也进行原样保存空文件
                            if (data_wxss) {
                                data_wxss = await cssHandle(data_wxss, file_wxss)
                                //
                                const content = `${ data_wxss }`

                                if (global.isMergeWxssToVue) {
                                    fileContentCss = `<style>\r\n${ content }\r\n</style>`
                                } else {
                                    //写入文件
                                    fs.writeFileSync(cssFilePath, content)
                                    utils.log(
                                        `Convert ${ path.relative(
                                            global.targetFolder,
                                            cssFilePath
                                        ) } success!`
                                    )
                                    fileContentCss = `<style>\r\n@import "./${ fileName }.css";\r\n</style>`
                                }

                                if (fileKey)
                                    global.pagesData[fileKey]['data']['css'] =
                                        fileContentCss || ''
                            } else {
                                fs.copySync(file_wxss, cssFilePath)
                            }
                        }

                        if (
                            !fileContentWxml &&
                            !fileContentJs &&
                            !fileContentCss
                        ) {
                            utils.log(fileName + ' is empty')
                            global.log.push(fileName + ' is empty')
                            count++
                            return
                        }


                        // fileContent = fileContentWxml + fileContentJs + fileContentCss;

                        // //写入文件
                        // fs.writeFile(targetFilePath, fileContent, () => {
                        // 	utils.log(`Convert ${path.relative(global.targetFolder, targetFilePath)} success!`);
                        // });
                    } else {
                        if (onlyWxmlFile) {
                            //只有wxml文件时，当组件来处理

                            let data_wxml = fs.readFileSync(file_wxml, 'utf8')
                            if (data_wxml) {

                                let wxmlData = await wxmlHandle(
                                    data_wxml,
                                    file_wxml,
                                    onlyWxmlFile
                                )

                                fileContent = wxmlData.templateString
                                if (fileContent) {
                                    let props = []
                                    if (
                                        global.props[file_wxml] &&
                                        global.props[file_wxml].length > 0
                                    ) {
                                        props = global.props[file_wxml]
                                    }
                                    let wxsImportStr = wxsInfoHandle(
                                        tFolder,
                                        file_wxml
                                    )
                                    let fileContentJs = `
	<script>
		${ wxsImportStr }
		export default {
			props: [${ props }]
		}
    </script>
									`

                                    //写入文件
                                    targetFilePath = path.join(tFolder, fileName + '.vue')

                                    //存入全局对象
                                    let fileKey = pathUtil.getFileKey(
                                        file_wxml
                                    )

                                    if (fileKey) {
                                        if (!global.pagesData[fileKey])
                                            global.pagesData[fileKey] = {}
                                        global.pagesData[fileKey]['data'] = {
                                            type: 'wxml',
                                            path: targetFilePath,
                                            js: fileContentJs,
                                            jsData: null,
                                            wxml: wxmlData.fileContent,
                                            minWxml: wxmlData.templateStringMin,
                                            wxmlData,
                                            css: ''
                                        }
                                    }
                                }
                            }
                        }
                        if (onlyJSFile) {
                            //如果是为单名的js文件，即同一个名字只有js文件，没有wxml或wxss文件，下同
                            if (file_js && fs.existsSync(file_js)) {
                                targetFilePath = path.join(
                                    tFolder,
                                    fileName + '.js'
                                )
                                let logStr = ""
                                let parentFolderName = pathUtil.getParentFolderName(file_js)
                                let ignoreFileNameReg = /sdk|base64|md5|wechat|\.min\./i
                                if (jsFileSize > MAX_FILE_SIZE) {
                                    fs.copySync(file_js, targetFilePath)
                                    delete global.pagesData[fileKey]

                                    logStr = '[tip]  文件体积超过500kb，忽略解析  file-->' + file_js
                                    utils.log(logStr)
                                    global.log.push(logStr)
                                } else if (fileName.toLowerCase().indexOf("sdk") > -1) {
                                    fs.copySync(file_js, targetFilePath)
                                    delete global.pagesData[fileKey]

                                    logStr = '[tip]  SDK相关文件，忽略解析  file-->' + file_js
                                    utils.log(logStr)
                                    global.log.push(logStr)
                                } else if (fileName.toLowerCase().indexOf(".min.") > -1) {
                                    fs.copySync(file_js, targetFilePath)
                                    delete global.pagesData[fileKey]

                                    logStr = '[tip]  压缩过的js文件，忽略解析  file-->' + file_js
                                    utils.log(logStr)
                                    global.log.push(logStr)
                                } else if (ignoreFileNameReg.test(fileName) || ignoreFileNameReg.test(parentFolderName)) {
                                    fs.copySync(file_js, targetFilePath)
                                    delete global.pagesData[fileKey]
                                } else {
                                    let data_js = fs.readFileSync(file_js, 'utf8')

                                    //可能文件为空，但它也存在。。。所以
                                    if (data_js) {
                                        // const { codeText: data, newFile } = await jsHandle(
                                        const jsData = await jsHandle(
                                            data_js,
                                            usingComponents,
                                            file_js,
                                            onlyJSFile,
                                            isAppFile
                                        )

                                        fileContent = jsData.fileContent
                                        file_js = jsData.newFile

                                        //写入文件
                                        if (isAppFile)
                                            targetFilePath = path.join(
                                                tFolder,
                                                'App.vue'
                                            )


                                        //存入全局对象
                                        let fileKey = pathUtil.getFileKey(file_js)
                                        if (fileKey) {
                                            if (!global.pagesData[fileKey])
                                                global.pagesData[fileKey] = {}
                                            global.pagesData[fileKey]['data'] = {
                                                type: 'js',
                                                path: targetFilePath,
                                                js: fileContent,
                                                jsData,
                                                wxml: '',
                                                css: ''
                                            }
                                        }
                                        //
                                        // fs.writeFile(targetFilePath, fileContent, () => {
                                        // 	utils.log(`Convert component ${path.relative(global.targetFolder, targetFilePath)} success!`);
                                        // });
                                    } else {
                                        fs.copySync(file_js, targetFilePath)
                                        delete global.pagesData[fileKey]
                                    }
                                }
                            }
                        }

                        if (onlyWxssFile) {
                            //读取.wxss文件
                            if (file_wxss && fs.existsSync(file_wxss)) {
                                let data_wxss = fs.readFileSync(
                                    file_wxss,
                                    'utf8'
                                )
                                targetFilePath = path.join(
                                    tFolder,
                                    fileName + '.css'
                                )
                                //可能文件为空，但它也存在。。。所以
                                if (data_wxss) {
                                    data_wxss = await cssHandle(
                                        data_wxss,
                                        file_wxss
                                    )
                                    let content = `${ data_wxss }`

                                    //存入全局对象
                                    let fileKey = pathUtil.getFileKey(
                                        file_wxss
                                    )
                                    if (fileKey) {
                                        if (!global.pagesData[fileKey])
                                            global.pagesData[fileKey] = {}
                                        global.pagesData[fileKey]['data'] = {
                                            type: 'css',
                                            path: targetFilePath,
                                            js: '',
                                            wxml: '',
                                            css: content
                                        }
                                    }

                                    //写入文件
                                    // fs.writeFile(targetFilePath, content, () => {
                                    // 	utils.log(`Convert ${path.relative(global.targetFolder, targetFilePath)}.wxss success!`);
                                    // });
                                } else {
                                    fs.copySync(file_wxss, targetFilePath)
                                }
                            }
                        }
                    }

                    count++
                    if (count >= total) {
                        //文件转换结束时
                        resolve()
                    }
                })(key)
            }
        })
    } catch (err) {
        utils.log(err)
    }
}

/**
 * 根据与data变量重名的函数名，将wxml里引用的地方进行替换
 * @param {*} fileContentWxml 转换后的template内容
 * @param {*} key 当前文件的key，替换为去掉后缀名的绝对路径
 */
function replaceFunName (fileContentWxml, key) {
    //这里使用正则替换先，精确的弄要改动的太多了。
    //根据与data变量重名的函数名，将wxml里引用的地方进行替换
    let result = fileContentWxml
    if (global.pagesData[key] && global.pagesData[key].replaceFunNameList) {
        const replaceFunNameList = global.pagesData[key].replaceFunNameList
        // let reg_funName = /(@.*?)="(abc|xyz)"/g;  //仅仅转换事件上面的函数
        let reg_funName = new RegExp(
            '(@\[\\w\.\]*)="(' + replaceFunNameList.join('|') + ')"',
            'mg'
        )
        result = fileContentWxml.replace(reg_funName, function (match, $1, $2) {
            return $1 + `="${ utils.getFunctionAlias($2) }"`
        })

        //转换其他位置，如标签内容
        for (const name of replaceFunNameList) {
            let reg_funName2 = new RegExp('\\b' + name + '\\(', 'mg')
            result = result.replace(
                reg_funName2,
                utils.getFunctionAlias(name) + '('
            )
        }
    }
    return result
}

/**
 * wxs信息处理
 * @param {*} tFolder   目录目录
 * @param {*} file_wxml 当前处理的wxml文件
 */
function wxsInfoHandle (tFolder, file_wxml) {
    let wxmlFolder = path.dirname(file_wxml)
    let key = path.join(wxmlFolder, pathUtil.getFileNameNoExt(file_wxml))

    //提取wxml里面的wxs信息
    let pageWxsInfoArr = global.pageWxsInfo[key]
    let str = ''
    if (pageWxsInfoArr && pageWxsInfoArr.length > 0) {
        pageWxsInfoArr.forEach(obj => {
            if (obj.type == 'insert') {
                let jsFilePath = path.join(tFolder, obj.src)
                obj.type = 'link' //改为link

                str += `import ${ obj.module } from '${ obj.src }'\r\n`

                if (global.isTransformWXS) {
                    //处理一下
                    wxsHandle(obj.content)
                        .then(fileContent => {
                            //写入文件
                            fs.writeFileSync(jsFilePath, fileContent)
                            utils.log(
                                `Convert wxs file ${ path.relative(
                                    global.targetFolder,
                                    jsFilePath
                                ) } success!`
                            )
                        })
                        .catch(error => {
                            utils.log('wxsHandle', error)
                            global.log.push('wxsHandle', error)
                            //写入文件
                            fs.writeFileSync(jsFilePath, obj.content)
                            utils.log(
                                `Convert wxs file ${ path.relative(
                                    global.targetFolder,
                                    jsFilePath
                                ) } success!`
                            )
                        })
                } else {
                    //写入文件
                    fs.writeFileSync(jsFilePath, obj.content)
                    utils.log(
                        `Convert wxs file ${ path.relative(
                            global.targetFolder,
                            jsFilePath
                        ) } success!`
                    )
                }
            }
        })
    }
    return str
}
/**
 * 处理小程序引用的npm包
 * 大概思路，将miniprogram_npm目录清空，然后再将node_modules下面的包内容，根据有无src目录进行移动
 */
function npmHandle () {
    if (global.miniprogram_npm_output && global.node_modules_output) {
        let folder = global.miniprogram_npm_output
        fs.readdir(folder, function (err, files) {
            // var tFolder = path.join(targetFolder, path.relative(miniprogramRoot, folder));
            files.forEach(function (fileName) {
                var fileDir = path.join(folder, fileName)
                let key = pathUtil.getFileKey(fileDir, global.targetFolder)
                // let newFileDir = path.join(tFolder, fileName);
                fs.stat(fileDir, function (err, stats) {
                    if (stats && stats.isDirectory()) {
                        let srcFolder = path.join(
                            global.node_modules_output,
                            fileName
                        )
                        let targetFolder = path.join(
                            global.miniprogram_npm_output,
                            fileName
                        )
                        let subSrcFolder = path.join(srcFolder, 'src')

                        if (fs.existsSync(subSrcFolder)) {
                            fs.copySync(subSrcFolder, targetFolder)
                        } else {
                            fs.copySync(srcFolder, targetFolder)
                        }
                    }
                })
            })
        })
    }
}

/**
 * 写入日志到生成目录时，再次转换将会被删除
 */
function writeLog (folder) {
    let logArr = global.log
    var logStr = logArr.join('\r\n')

    let file_log = path.join(folder, 'transform_log.log')
    //写入文件
    fs.writeFileSync(file_log, logStr)
}


/**
 * 预处理
 */
function preHandle (folder, hbxOutputChannel) {

    //检查是否为vant项目
    //检查什么小程序，就后面再展示
    global.hbxOutputChannel = hbxOutputChannel
}

/**
 * 转换入口
 * @param {*} sourceFolder     输入目录
 * @param {*} targetFolder     输出目录，默认为"输入目录_uni"，vue-cli模式时为"_uni_vue-cli"
 * @param {*} isVueAppCliMode  是否需要生成vue-cli项目，默认为false
 * @param {*} isTransformWXS   【已弃用】是否需要转换wxs文件，默认为false，目前uni-app已支持wxs文件，仅支持app和小程序
 * @param {*} isVantProject    是否为vant项目，默认为false
 * @param {*} isRenameWxToUni  是否转换wx为uni，默认为true
 * @param {*} isMergeWxssToVue 是否合并wxss到vue文件，默认为false
 * @param {*} isRepair         是否修复js语法，默认为false
 * @param {*} callback         回调函数
 */
async function transform (
    sourceFolder,
    options,
    callback = null
) {

    if (!utils.isObject(options)) {
        throw ("参数错误：配置参数已全部放置在第 2 个参数，请及时修改")
    }

    let targetFolder = options.targetFolder || ""
    let isVueAppCliMode = options.isVueAppCliMode || false
    let isTransformWXS = options.isTransformWXS || false
    let isVantProject = options.isVantProject || false
    let isRenameWxToUni = options.isRenameWxToUni || !options.hasOwnProperty("isRenameWxToUni") ? true : false
    let isMergeWxssToVue = options.isMergeWxssToVue || false
    let isRepair = options.isRepair || false
    let isHBuildXPlugin = options.isHBuildXPlugin || false  //是否是hbuildx plugin调用


    fileData = {}
    routerData = {}

    global.log = [] //记录转换日志，最终生成文件
    //记录日志里同类的数据
    global.logArr = {
        fish: [], //漏网之鱼
        template: [], //template
        rename: [] //重名
    }

    //起始时间
    const startTime = new Date()

    //如果选择的目录里面只有一个目录的话，那就把source目录定位为此目录，暂时只管这一层，多的不理了。
    var readDir = fs.readdirSync(sourceFolder)
    if (readDir.length === 1) {
        var baseFolder = path.join(sourceFolder, readDir[0])
        var statInfo = fs.statSync(baseFolder)
        if (statInfo.isDirectory()) {
            sourceFolder = baseFolder
        }
    }

    utils.log(`项目 '${ path.basename(sourceFolder) }' 开始转换...`)
    utils.log("sourceFolder = " + sourceFolder)
    let miniprogramRoot = sourceFolder

    //因后面会清空输出目录，为防止误删除其他目录/文件，所以这里不给自定义!!!
    if (isVueAppCliMode) {
        targetFolder = sourceFolder + '_uni_vue-cli'
    } else {
        targetFolder = sourceFolder + '_uni'
    }

    //读取小程序项目配置
    const configData = projectHandle.getProjectConfig(miniprogramRoot, sourceFolder)

    //复制云函数目录
    if (configData.cloudfunctionRoot) {
        var cloudfunctionRoot = configData.cloudfunctionRoot.replace(/\//, '')
        var cloudfunctionRootAbsPath = path.join(miniprogramRoot, cloudfunctionRoot)
        var targetCloudfunctionRoot = path.join(targetFolder, cloudfunctionRoot)
        if (fs.existsSync(cloudfunctionRootAbsPath)) {
            fs.copySync(cloudfunctionRootAbsPath, targetCloudfunctionRoot)
        }
    }

    // if(configData.compileType && configData.compileType !== "miniprogram")
    // {
    // 	utils.log("输入项目不是小程序项目" + configData.compileType)
    // }

    //小程序项目目录，不一定就等于输入目录，有无云开发的目录结构是不相同的。
    miniprogramRoot = configData.miniprogramRoot

    /////////////////////定义全局变量//////////////////////////
    //之前传来传去的，过于麻烦，全局变量的弊端就是过于耦合了。
    global.miniprogramRoot = miniprogramRoot
    global.sourceFolder = sourceFolder

    //是否需要生成为vue-cli项目
    global.isVueAppCliMode = isVueAppCliMode

    //是否需要转换wxs文件，默认为true
    global.isTransformWXS = isTransformWXS || false

    //是否合并wxss到vue文件
    global.isMergeWxssToVue = isMergeWxssToVue || false

    //判断是否含使用vant
    global.hasVant = isVantProject

    //是否修复js
    global.isRepair = isRepair

    //判断是否为ts项目,ts项目里tsconfig.json必须存在
    let tsconfigPath = path.join(sourceFolder, 'tsconfig.json')
    global.isTSProject = fs.existsSync(tsconfigPath)

    // mp-html替换wxparse细节
    // 1.使用mp-html替换wxparse，hbxv2.5.5以上不用申明组件;
    // 2.解析wxParse.wxParse('contentT', 'html', content, this, 0);
    // 为：setTimeout(()=> {this.article = goodsDetail.content;});
    // 3.去掉const wxParse = require("../../../wxParse/wxParse.js");
    // 4.在data里加入article
    //项目是否使用wxParse（判断是否有wxParse目录和wxParse文件）
    global.hasWxParse = false

    //项目是否使用weui
    global.hasWeUIJS = false
    global.hasWeUIWxml = false

    //是否将wx.xxx()转换为uni.xxx()
    global.isRenameWxToUni = isRenameWxToUni

    //是否提取到static及转换资源的路径(注意：现阶段仍然为true，2020-03-16)
    global.isTransformAssetsPath = true

    //记录当前项目的项目类型，猜测！默认是微信小程序
    global.mpType = "wx"

    //具体的名
    global.mpTypeName = "wx"

    //数据统计
    global.stats = {
        loginNum: 0,
        payNum: 0,
        vueFileNum: 0,
    }

    //是否为编译过的项目
    let runtimePath = path.join(sourceFolder, 'common/runtime.js')
    let vendorPath = path.join(sourceFolder, 'common/vendor.js')
    global.isCompiledProject = fs.existsSync(runtimePath) && fs.existsSync(vendorPath)

    //编译后的项目的文件信息
    global.compiledData = {}

    // utils.log(" global.isCompiledProject = " + global.isCompiledProject)

    //记录<template name="abc"></template>内容，用于另存
    global.globalTemplateComponents = {
        //name: ast
    }

    //两个目录类型和作用不同
    if (global.isVueAppCliMode) {
        //输出目录
        global.outputFolder = targetFolder
        //src目录
        global.targetFolder = targetFolder = path.join(targetFolder, 'src')
        //含资源文件的目录信息，用于写入到vue.config.js里，否则uni-app编译时将删除
        global.assetsFolderObject = new Set()
    } else {
        //输出目录
        global.outputFolder = targetFolder
        //输出的小程序目录
        global.targetFolder = targetFolder
    }

    //miniprogram_npm目录
    global.miniprogram_npm = path.join(sourceFolder, 'miniprogram_npm')
    global.miniprogram_npm_output = path.join(targetFolder, 'miniprogram_npm')
    if (!fs.existsSync(global.miniprogram_npm)) {
        global.miniprogram_npm = global.miniprogram_npm_output = ''
    }

    //node_modules目录
    global.node_modules = path.join(sourceFolder, 'node_modules')
    global.node_modules_output = path.join(targetFolder, 'node_modules')
    if (!fs.existsSync(global.node_modules)) {
        global.node_modules = global.node_modules_output = ''
    }

    //
    global.log.push('miniprogram to uni-app 转换日志')
    global.log.push('')
    global.log.push('---基本信息---')
    global.log.push('时间: ' + utils.formatDate(new Date(), 'yyyy-MM-dd hh:mm:ss'))
    global.log.push(
        '语言: ' + (global.isTSProject ? 'TypeScript' : 'Javascript')
    )
    global.log.push(
        '转换模式: ' + (global.isVueAppCliMode ? 'vue-cli' : 'Hbuilder X')
    )
    global.log.push('isTransformWXS: ' + global.isTransformWXS)
    global.log.push('isRenameWxToUni: ' + global.isRenameWxToUni)
    global.log.push('isMergeWxssToVue: ' + global.isMergeWxssToVue)
    global.log.push('isRepair: ' + global.isRepair)
    global.log.push('')
    global.log.push('---小程序基本信息---')
    global.log.push('name: ' + configData.name)
    global.log.push('version: ' + configData.version)
    global.log.push('description: ' + configData.description)
    global.log.push('appid: ' + configData.appid)
    global.log.push('projectname: ' + configData.projectname)
    global.log.push('compileType: ' + configData.compileType)
    global.log.push('author: ' + configData.author)
    global.log.push('')
    global.log.push('---目录信息---')
    global.log.push('sourceFolder: ' + sourceFolder)
    global.log.push('targetFolder: ' + global.targetFolder)
    global.log.push('outputFolder: ' + global.outputFolder)
    global.log.push('miniprogramRoot: ' + global.miniprogramRoot)
    global.log.push('')
    global.log.push('---日志信息---')

    //
    utils.log('outputFolder = ' + global.outputFolder)
    utils.log('targetFolder = ' + global.targetFolder)

    utils.log('正在转换中...')

    //大部分页面的数据
    global.pagesData = {
        //fileKey:{
        // 		replaceFunNameList:"",
        // 		data:{   // 存储第二次转换出来的文件数据
        //  	    type:"all/js/wxml/css",
        //  	    path: "file path",
        // 			js: "",
        // 			wxml: "",
        // 			minWxml: "",
        // 		   	css: ""
        //     },
        //     getAppNamelist:[]
        // 	}
    }
    //存储wxml组件页面里面，需要对外开放的参数(本想不做全局的，然而传参出现问题，还是全局一把梭)
    global.props = {
        //"文件路径":[]
    }

    global.pageWxsInfo = {} //存储页面里的wxs信息，数据格式如下所示
    //---数据格式[解析wxs时]
    // {
    // 	"文件路径":[
    //	   {
    //		"name":"module name",
    //		"type":"link or insert",
    //		"content":"路径或内容",
    //	   }
    //  ]
    // }
    //---数据格式[不解析wxs时]
    // {
    // 	"文件路径":[
    //	    wxs内容
    //   ]
    // }
    //

    //存储页面里的include信息，数据格式如下所示
    global.includeInfo = [
        //{
        // 	  attrs:""                //include标签的参数字符串
        //    curFileKey:"",          //wxml文件所对应的fileKey
        //    includeTag:"",          //完整include标签
        //    includeFileKey:"",      //include的wxml文件所对应的fileKey
        // 	  includeWxmlAbsPath:"",  //include的wxml文件的绝对路径
        // }
    ]

    //存储页面里的template信息，数据格式如下所示
    global.templateInfo = {
        tagList: [
            //所有要替换的标签
            //{
            //    key: "",                 //此key等同于template的name或is属性
            // 	  attrs:""                 //include标签的参数字符串
            //    curFileKey:"",           //wxml文件所对应的fileKey
            //    templateTag:"",          //完整include标签
            //    templateFileKey:"",      //template的wxml文件所对应的fileKey
            // 	  templateWxmlAbsPath:"",  //template的wxml文件的绝对路径
            // }
        ],
        templateList: {
            //对应的tempalte内容
            //key: ast, //此key等同于template的name或is属性
        }
    }

    global.wxsFileList = {} //存储所有已经处理过的wxs文件

    global.assetInfo = {} //存储所有的资源路径

    try {
        if (fs.existsSync(global.outputFolder)) {
            // pathUtil.emptyDirSyncEx(global.targetFolder);  //不清空了
        } else {
            pathUtil.mkdirsSync(global.outputFolder)
        }
    } catch (error) {
        utils.log(`[Error] ${ global.outputFolder }可能被其他文件占用，请手动删除再试`)
        return
    }

    utils.sleep(300)

    if (!fs.existsSync(global.targetFolder)) {
        //创建输出目录，如果是vue-cli模式，那就直接创建src目录，这样输出目录也会一并创建
        pathUtil.mkdirsSync(global.targetFolder)
    }

    if (!fs.existsSync(miniprogramRoot)) {
        utils.log("源目录不存在！", miniprogramRoot)
    }


    traverseFolder(miniprogramRoot, miniprogramRoot, targetFolder, async () => {
        //处理文件组
        filesHandle(fileData, miniprogramRoot).then(async () => {
            //
            await projectHandle.projectHandle(global.pagesData)

            //将<template name="abc"/>标签全部存为component组件
            let componentFolder = path.join(targetFolder, 'components')
            if (!fs.existsSync(componentFolder)) {
                pathUtil.mkdirsSync(componentFolder)
            }
            //1226
            for (const name in global.globalTemplateComponents) {
                const componentData = global.globalTemplateComponents[name]
                const fileContent = templateParser.astToString([
                    componentData.ast
                ])
                const alias = componentData.alias //有可能组件名与内置关键字冲突，这里使用别名
                if (!alias || !fileContent) continue

                let componentFile = path.join(componentFolder, alias + '.vue')

                //写入文件
                fs.writeFileSync(componentFile, fileContent)
                utils.log(`write component file ${ alias } success!`)
            }

            //处理配置文件
            configHandle(configData, routerData, miniprogramRoot, targetFolder)

            //拷贝mp-html到components
            if (global.hasWxParse) {
                //mp-html
                const sourceMpHtml = path.join(__dirname, 'wx2uni/project-template/uni_modules')
                const targetMpHtml = path.join(targetFolder, 'uni_modules')
                fs.copySync(sourceMpHtml, targetMpHtml)
            }

            //components
            const source = path.join(__dirname, 'wx2uni/project-template/components')
            const target = path.join(targetFolder, 'components')
            fs.copySync(source, target)

            //拷贝wxcomponents到根目录
            if (global.hasVant) {
                const source = path.join(__dirname, 'wx2uni/project-template/wxcomponents')
                const target = path.join(targetFolder, 'wxcomponents')
                if (!fs.existsSync(target)) {
                    pathUtil.mkdirsSync(target)
                }
                fs.copySync(source, target)
            }

            //生成vue-cli项目所需要的文件
            if (global.isVueAppCliMode) {
                vueCliHandle(
                    configData,
                    global.outputFolder,
                    global.assetsFolderObject,
                    true
                )
            }

            //npm目录处理
            npmHandle()

            //日志分类进行输出，方便查看
            for (const item of global.logArr.fish) {
                global.log.push(item)
            }
            for (const item of global.logArr.rename) {
                global.log.push(item)
            }
            for (const item of global.logArr.template) {
                global.log.push(item)
            }


            //输出提示
            setTimeout(() => {
                let str = '\r\n'
                const time = new Date().getTime() - startTime.getTime()
                str += "总共 " + global.stats.payNum + " 处调用支付Api\r\n"
                str += "输出 " + global.stats.vueFileNum + " 个vue文件\r\n"
                str += '耗时：' + time + 'ms\r\n'

                if (global.isVueAppCliMode) {
                    str +=
                        '当前转换模式：【vue-cli】，生成vue-cli项目，注意输出目录带有 vue-cli 后缀。\r\n优点：所有资源文件位置与原项目一致，资源引用完美；\r\n缺点：上手有点点难度，转换完成后，需要运行命令：npm i\r\n\r\n'
                } else {
                    str +=
                        '当前转换模式：【Hbuilder X】，生成Hbuilder X 项目。\r\n\r\n'
                }
                // if (isVantProject && global.hasVant !== isVantProject) {
                //     str +=
                //         '\r\n\r\n\r\n注意!!! \r\n注意!!! \r\n注意!!!\r\n检测到当前项目使用了vant组件，已经自动按vant项目进行转换(转换后的项目仅支持app和H5 ！！！)。\r\n\r\n';
                // }

                //常见问答
                str += `\r\n常见问题：\r\n`
                questions.forEach(function(obj){
                    str += `问：${obj.q}\r\n`
                    str += `答：${obj.a}\r\n`
                    str += `\r\n`
                })

                str += `更多信息请阅读答疑文档：https://gitee.com/zhangdaren/articles/blob/master/miniprogram-to-uniapp工具答疑.md\r\n`
                str += `\r\n`
                str += `gitee：https://gitee.com/zhangdaren/miniprogram-to-uniapp\r\n`
                str += `github：https://github.com/zhangdaren/miniprogram-to-uniapp\r\n`
                str += `\r\n`
                str += `热烈欢迎各位大佬star和issue!\r\n`

                if (isVantProject) {
                    str +=
                        '\r\n\r\n\r\n注意!!! \r\n注意!!! \r\n注意!!!\r\n因uniapp限制，当前转换后的Uniapp项目仅支持app和H5 ！！！仅支持app和H5 ！！！仅支持app和H5 ！！！。\r\n\r\n'
                }

                if (global.isCompiledProject) {
                    str +=
                        '\r\n\r\n\r\n注意!!! \r\n注意!!! \r\n注意!!!\r\n源项目可能是uniapp编译后的微信小程序项目，暂不支持转换，转换后也非完整项目！！！\r\n\r\n'
                }

                if (global.hasWeUIJS && global.hasWeUIWxml) {
                    str +=
                        '\r\n\r\n\r\n注意!!! \r\n注意!!! \r\n注意!!!\r\n源项目可能是引用了 We UI 组件，转换后不太好修复。 建议重新转换，转换前先 “备份” 源项目，再使用 https://gitee.com/zhangdaren/weui-miniprogram-js 替换 We UI 后，再进行转换！！！\r\n\r\n'
                }

                str = '\r\n转换完成: ' + str

                global.log.push(str)
                utils.log(str, 'base')
                writeLog(global.outputFolder)

                utils.isFunction(callback) && callback(global.outputFolder)
            }, 1000)
        })
    })
}

module.exports = { transform, preHandle }
