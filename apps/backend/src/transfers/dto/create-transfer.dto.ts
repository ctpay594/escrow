import { Type } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import type { PayoutMode } from '../transfers.types';

const PAYOUT_MODES = ['IMPS', 'NEFT', 'RTGS', 'UPI'] as const;

export class CreateTransferDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  amount!: number;

  @IsIn(PAYOUT_MODES)
  payout_mode!: PayoutMode;

  @IsOptional()
  @IsString()
  @MinLength(1)
  transaction_note?: string;

  @IsString()
  @MinLength(2)
  beneficiary_account_name!: string;

  @ValidateIf((dto: CreateTransferDto) => dto.payout_mode !== 'UPI')
  @IsString()
  @MinLength(6)
  beneficiary_account_no?: string;

  @ValidateIf((dto: CreateTransferDto) => dto.payout_mode !== 'UPI')
  @IsString()
  @MinLength(11)
  beneficiary_ifsc?: string;

  @ValidateIf((dto: CreateTransferDto) => dto.payout_mode === 'UPI')
  @IsString()
  @MinLength(5)
  beneficiary_vpa?: string;
}
