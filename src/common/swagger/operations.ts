import { applyDecorators } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

export const ApiProtectedOperation = (summary: string) => applyDecorators(
  ApiOperation({ summary }),
  ApiBadRequestResponse({ description: 'The request payload or parameters are invalid.' }),
  ApiUnauthorizedResponse({ description: 'A valid, active bearer session is required.' }),
);

export const ApiOwnerOperation = (summary: string) => applyDecorators(
  ApiProtectedOperation(summary),
  ApiForbiddenResponse({ description: 'Owner role is required.' }),
);

export const ApiPublicOperation = (summary: string) => applyDecorators(
  ApiOperation({ summary }),
  ApiBadRequestResponse({ description: 'The request payload or parameters are invalid.' }),
  ApiTooManyRequestsResponse({ description: 'The public endpoint rate limit was exceeded.' }),
);
