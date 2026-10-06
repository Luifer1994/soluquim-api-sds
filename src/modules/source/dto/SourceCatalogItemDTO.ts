import { SourceInfo, SourceRuntimeState } from '@/modules/source/dto/SourceInfo';
import { SourceCodeEnum } from '@/modules/source/enums';

export interface SourceCatalogItemDTO extends SourceInfo, SourceRuntimeState {
  code: SourceCodeEnum;
}
