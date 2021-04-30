/*
 *
 * 处理wxml文件
 *
 */
const path = require('path')

const TemplateParser = require('./wxml/TemplateParser')
const templateConverter = require('./wxml/templateConverter')
const templateConverterLite = require('./wxml/templateConverterLite')

const pathUtil = require('../utils/pathUtil.js')

//初始化一个解析器
templateParser = new TemplateParser()

/**
 * 判断是否为多根元素模式
 * 分为两种情况：
 * 1.wxml里有多个tag标签
 * 2.根元素含有wx:for或v-for属性
 * 3.单标签，但不是view标签
 * @param {*} ast
 */
function checkMultiTag (ast) {
    //判断是否有多个标签存在于一个wxml文件里
    let isMultiTag = false
    let count = 0
    ast.forEach(node => {
        if (node.type == 'tag' && node.name !== 'wxs') {
            count++
            //如果根元素含有wx:for，需要在外面再包一层
            if (node.attribs['wx:for'] || node.attribs['v-for'])
                isMultiTag = true
        }
    })
    if (count > 1) isMultiTag = true

    //如果仅有一个标签，但标签名不是view，那么也算多标签
    if (!isMultiTag && ast.length === 1) {
        let item = ast[0]
        isMultiTag = item.name !== 'view'
    }

    return isMultiTag
}

/**
 * 检查ast里是否全是注释，是就清空
 * @param {*} ast
 */
function checkEmptyTag (ast) {
    let count = 0
    ast.forEach(node => {
        if (node.type == 'tag') {
            count++
        }
    })

    if (count === 0) {
        ast = []
    }
    return ast
}

/**
 * wxml文件处理
 * @param {*} fileData wxml文件内容
 * @param {*} file_wxml 当前操作的文件路径
 */
async function wxmlHandle (fileData, file_wxml, onlyWxmlFile) {
    let reg = /<template([\s\S]*?)<\/template>/g

    //查找有多少个template
    let tmpArr = fileData.match(reg) || []
    let templateNum = tmpArr.length

    //生成语法树
    let templateAst = await templateParser.parse(fileData)


    //判断根标签上是否包含wx:for或v-for
    let isMultiTag = checkMultiTag(templateAst) || templateNum > 0

    //进行上述目标的转换
    let convertedTemplate = null
    if (global.isCompiledProject) {
        convertedTemplate = await templateConverterLite(
            templateAst,
            file_wxml,
            onlyWxmlFile,
            templateParser
        )
    } else {
        convertedTemplate = await templateConverter(
            templateAst,
            file_wxml,
            onlyWxmlFile,
            templateParser
        )
    }

    //判断ast是否没有tag，是的话就全删除
    convertedTemplate = checkEmptyTag(convertedTemplate)

    //把语法树转成文本
    let templateConvertedString =
        templateParser.astToString(convertedTemplate) || fileData

    //去掉首尾空，有可能文件内容都删除完了。
    templateConvertedString = templateConvertedString.trim()

    //不加template标签的wxml，用于导入include
    const templateConvertedStringMin = templateConvertedString
    let wxsTagList = [];
    if (templateConvertedString) {
        if (isMultiTag) {
            templateConvertedString = `<template>\r\n<view>\r\n${ templateConvertedString }\r\n</view>\r\n</template>\r\n\r\n`
        } else {
            templateConvertedString = `<template>\r\n${ templateConvertedString }\r\n</template>\r\n\r\n`
        }

        //如果不进行转换wxs的话，那么需要把wxs标签移到template下面来
        //当前处理文件所在目录
        let wxmlFolder = path.dirname(file_wxml)
        // key为文件路径 + 文件名(不含扩展名)组成
        let key = path.join(
            wxmlFolder,
            pathUtil.getFileNameNoExt(file_wxml)
        )
        let pageWxsInfoArr = global.pageWxsInfo[key]
        if (pageWxsInfoArr) {
            // const wxsInfoString = templateParser.astToString(pageWxsInfoArr);
            // let wxsStr = wxsInfoString + "\r\n";
            // templateConvertedString += wxsStr + "\r\n";

            //转换为<script/>方式引用wxs
            let wxsStr = ''
            for (const obj of pageWxsInfoArr) {
                var str = `<script module="${ obj.module }" lang="wxs" src="${ obj.src }"></script>`
                wxsStr += str + `\r\n`
                wxsTagList.push(str)
            }
            templateConvertedString += wxsStr + '\r\n'
        }
    }
    return {
        isMultiTag,
        wxsTagList,
        ast: convertedTemplate,
        templateString: templateConvertedString,
        templateStringMin: templateConvertedStringMin,
    }
}

module.exports = wxmlHandle
