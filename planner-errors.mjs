const messages={
 AI_PLAN_INVALID:[502,'暂时没能整理出可用的操作。请补充或重新描述需求，例如「给林晓转 300 元」；本次未执行操作。'],
 AI_REPLY_INCOMPLETE:[502,'这次回复不完整，请重新发送问题；本次未执行操作。'],
 AI_SERVICE_UNAVAILABLE:[503,'智能助手暂时不可用，请稍后重试，也可以使用页面上的业务入口；本次未执行操作。'],
 AI_SERVICE_TIMEOUT:[504,'智能助手回复超时，请稍后重试；本次未执行操作。'],
 AI_BUSY:[429,'智能助手正在处理其他问题，请稍后重试；本次未执行操作。']
};
export function plannerError(code,detail,cause){
 const error=new Error(detail||messages[code]?.[1]||'Planning failed',cause?{cause}:undefined);
 error.name='PlannerError';error.code=code;error.status=messages[code]?.[0]||502;return error;
}
export function plannerErrorResponse(error){
 const known=messages[error?.code];return known?{status:known[0],body:{error:known[1],code:error.code}}:null;
}
