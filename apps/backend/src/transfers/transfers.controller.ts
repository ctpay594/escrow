import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateBulkTransferDto } from './dto/create-bulk-transfer.dto';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { TransfersService } from './transfers.service';

@Controller('transfers')
@UseGuards(JwtAuthGuard)
export class TransfersController {
  constructor(private readonly transfersService: TransfersService) {}

  @Get()
  listTransfers(@CurrentUser() user: JwtPayload) {
    return this.transfersService.listTransfersForUser(user.sub);
  }

  @Post('bulk')
  createBulkTransfer(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateBulkTransferDto,
  ) {
    return this.transfersService.createBulkTransfer(
      user.sub,
      dto.transfers.map((item) => ({
        userId: user.sub,
        amount: item.amount,
        payoutMode: item.payout_mode ?? 'IMPS',
        transactionNote: item.transaction_note,
        beneficiaryAccountName: item.beneficiary_account_name,
        beneficiaryAccountNo: item.beneficiary_account_no,
        beneficiaryIfsc: item.beneficiary_ifsc,
        beneficiaryVpa: item.beneficiary_vpa,
      })),
      dto.label,
    );
  }

  @Post()
  createTransfer(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateTransferDto,
  ) {
    return this.transfersService.createTransfer({
      userId: user.sub,
      amount: dto.amount,
      payoutMode: dto.payout_mode,
      transactionNote: dto.transaction_note,
      beneficiaryAccountName: dto.beneficiary_account_name,
      beneficiaryAccountNo: dto.beneficiary_account_no,
      beneficiaryIfsc: dto.beneficiary_ifsc,
      beneficiaryVpa: dto.beneficiary_vpa,
    });
  }

  @Post('reconcile-status')
  reconcileStatus(@CurrentUser() user: JwtPayload) {
    return this.transfersService.reconcileProcessingTransfersForUser(user.sub);
  }
}
