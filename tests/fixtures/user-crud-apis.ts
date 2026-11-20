// These demo APIs are test fixtures only; the production asset loader must not expose them.
const template = (value: string) => ({ template: `{{${value}}}` })
const condition = (fieldName: string, fieldValue: unknown, conditionType = 'EQ') => ({
  group: false, conditionType, fieldName, fieldValue,
})
const fields = ['id', 'name', 'email', 'created_at', 'updated_at']

function api(uuid: string, method: string, request: unknown, functionName: string,
  inputs: Record<string, unknown>, outputs: string[], response: unknown) {
  return {
    uuid, method, request,
    blocks: [
      { uuid: 'starter', nextBlock: 'operation' },
      {
        uuid: 'operation', functionName,
        inputs: { datasource: 'Mokelay', table: 'employees', ...inputs },
        outputs, nextBlock: null,
      },
    ],
    responses: { operation: response },
  }
}

export const userCrudApis: Record<string, unknown> = {
  create_user_info: api('create_user_info', 'POST', { body: ['name', 'email', 'password_hash'] }, 'create', {
    idField: 'id',
    fields: {
      name: template('request.body.name'),
      email: template('request.body.email'),
      password_hash: template('request.body.password_hash'),
    },
  }, ['uuid'], { id: template('blocks.operation.outputs.uuid') }),
  read_user_by_id: api('read_user_by_id', 'GET', { query: ['id'] }, 'read', {
    fields, conditions: [condition('id', template('request.query.id'))],
  }, ['data'], { user_info: template('blocks.operation.outputs.data') }),
  update_user_info_by_id: api('update_user_info_by_id', 'POST', { query: ['id'], body: ['name', 'email'] }, 'update', {
    fields: { name: template('request.body.name'), email: template('request.body.email') },
    conditions: [condition('id', template('request.query.id'))],
  }, ['affected'], { update: true }),
  count_free_users: api('count_free_users', 'GET', {}, 'count', {
    conditions: [condition('plan', 'free')],
  }, ['total'], { total: template('blocks.operation.outputs.total') }),
  read_user_list: api('read_user_list', 'POST', { body: ['name', 'created_at_begin', 'created_at_end'] }, 'list', {
    fields,
    conditions: [
      condition('name', template('request.body.name')),
      condition('created_at', template('request.body.created_at_begin'), 'GE'),
      condition('created_at', template('request.body.created_at_end'), 'LE'),
    ],
  }, ['datas'], { user_list: template('blocks.operation.outputs.datas') }),
  delete_user_info_by_id: api('delete_user_info_by_id', 'POST', { body: ['id'] }, 'delete', {
    conditions: [condition('id', template('request.body.id'))],
  }, ['affected'], { message: '删除成功' }),
}
