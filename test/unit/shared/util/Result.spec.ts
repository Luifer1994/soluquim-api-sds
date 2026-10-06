import { buildApiResponse, Result } from '@/shared/util';

describe('Result y sobre de respuesta', () => {
  it('success por defecto es 200', () => {
    const result = Result.success({ id: 1 });
    expect(result.isSuccess).toBe(true);
    expect(result.statusCode).toBe(200);
  });

  it('accepted es 202', () => {
    expect(Result.accepted({ jobId: 'x' }).statusCode).toBe(202);
  });

  it('failure guarda el código interno pero no lo expone en el sobre', () => {
    const result = Result.failure('SOME_CODE', 'No se pudo', 409);
    const body = buildApiResponse(result.statusCode, result.message, result.data);
    expect(result.errorCode).toBe('SOME_CODE');
    expect(Object.keys(body)).toEqual(['timestamp', 'status', 'message', 'data']);
    expect(body).toMatchObject({ status: 409, message: 'No se pudo', data: null });
  });
});
