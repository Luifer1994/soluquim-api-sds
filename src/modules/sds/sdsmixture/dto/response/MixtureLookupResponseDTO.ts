import { SubstanceResponseDTO } from '@/modules/substance';
import { MixtureComponentStatusEnum } from '@/modules/sds/sdsmixture/enums';

export interface MixtureComponentResultDTO {
  cas: string;
  percentage: number;
  status: MixtureComponentStatusEnum;
  message: string;
  substance: SubstanceResponseDTO | null;
}

export interface MixtureLookupResponseDTO {
  componentCount: number;
  totalPercentage: number;
  warnings: string[];
  summary: Record<MixtureComponentStatusEnum, number>;
  components: MixtureComponentResultDTO[];
}
