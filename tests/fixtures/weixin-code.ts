// A deliberately multiline regression fixture based on the reported example.
// We never infer lost line breaks from already flattened code.
export const departmentCode = `// 抽象模型：
// 资源 A：companyId —— 用于判断当前用户是否有该公司权限
// 资源 B：departmentId —— 实际被修改的部门对象
// 漏洞点：鉴权参数与操作对象参数没有绑定校验

function updateDepartment(request):
    user = getCurrentUserFromSessionOrToken()   // 可信身份，来自服务端会话/令牌

    companyId    = request.body.companyId       // 客户端可控
    departmentId = request.body.departmentId    // 客户端可控
    newName      = request.body.name

    // 1. 使用 companyId 做权限校验：当前用户是否有该公司权限
    if not hasCompanyPermission(user, companyId):
        return 403

    // 2. 漏洞：直接按 departmentId 修改部门
    //    没有校验 departmentId 是否属于 companyId
    //    也没有校验 user 是否有该部门的操作权限
    updateDepartmentById(departmentId, { name: newName })

    return 200`

export const tabbedCode = '/* 中文注释\n\t权限校验 */\n\nif allowed:\n\treturn "<script>literal</script> & value"\n'
export const longCommand = 'curl --header "Content-Type: application/json" "https://example.test/?' + 'value=sample&'.repeat(24) + 'end=1"'
